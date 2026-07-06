use chrono::Utc;
use keyring::Entry;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};
use uuid::Uuid;

const KEYCHAIN_SERVICE: &str = "com.huqi.tender-screenshot-agent";
const WECOM_BOT_ID_ACCOUNT: &str = "wecom-bot-id";
const WECOM_BOT_SECRET_ACCOUNT: &str = "wecom-bot-secret";
const WECOM_PROFILE_ID: &str = "wecom-bot";

struct AppState {
    db: Mutex<Connection>,
}

#[derive(Debug, Serialize)]
struct Task {
    id: String,
    name: String,
    status: String,
    created_at: String,
    query_count: i64,
    platform_count: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTaskInput {
    name: String,
    queries: Vec<String>,
    platform_ids: Vec<String>,
    privacy_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigureWeComBotInput {
    bot_id: String,
    secret: String,
    target_chat_ids: Vec<String>,
    websocket_url: Option<String>,
    enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendWeComBotMarkdownInput {
    markdown: String,
    target_chat_ids: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WeComBotStatus {
    configured: bool,
    enabled: bool,
    target_count: usize,
    websocket_url: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug)]
struct WeComProfile {
    enabled: bool,
    target_chat_ids: Vec<String>,
    websocket_url: Option<String>,
    updated_at: String,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn init_db(root: &PathBuf) -> Connection {
    fs::create_dir_all(root).expect("create application data directory");
    let db = Connection::open(root.join("tender-agent.db")).expect("open sqlite database");
    db.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS tasks(
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL,
          privacy_mode TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_items(
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          query_name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS event_logs(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notification_profiles(
          id TEXT PRIMARY KEY,
          transport TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          target_chat_ids_json TEXT NOT NULL,
          websocket_url TEXT,
          updated_at TEXT NOT NULL
        );
        ",
    )
    .expect("migrate sqlite");
    db
}

fn log_event(db: &Connection, task_id: Option<&str>, level: &str, message: &str) -> Result<(), String> {
    db.execute(
        "INSERT INTO event_logs(task_id,level,message,created_at) VALUES(?1,?2,?3,?4)",
        params![task_id, level, message, now()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn keychain_entry(account: &str) -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, account).map_err(|error| format!("keychain unavailable: {error}"))
}

fn set_keychain_value(account: &str, value: &str) -> Result<(), String> {
    keychain_entry(account)?
        .set_password(value)
        .map_err(|error| format!("unable to save credential in OS keychain: {error}"))
}

fn get_keychain_value(account: &str) -> Result<String, String> {
    keychain_entry(account)?
        .get_password()
        .map_err(|error| format!("credential not available in OS keychain: {error}"))
}

fn normalize_targets(values: Vec<String>) -> Vec<String> {
    let mut output = Vec::new();
    for value in values {
        let value = value.trim();
        if !value.is_empty() && !output.iter().any(|existing| existing == value) {
            output.push(value.to_string());
        }
    }
    output
}

fn load_wecom_profile(db: &Connection) -> Result<Option<WeComProfile>, String> {
    db.query_row(
        "SELECT enabled,target_chat_ids_json,websocket_url,updated_at FROM notification_profiles WHERE id=?1 AND transport='wecom-bot-id-secret'",
        params![WECOM_PROFILE_ID],
        |row| {
            let targets_json: String = row.get(1)?;
            Ok(WeComProfile {
                enabled: row.get::<_, i64>(0)? != 0,
                target_chat_ids: serde_json::from_str(&targets_json).unwrap_or_default(),
                websocket_url: row.get(2)?,
                updated_at: row.get(3)?,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn sidecar_command() -> Result<Command, String> {
    if let Ok(binary) = env::var("TENDER_SIDECAR_BIN") {
        if !binary.trim().is_empty() {
            return Ok(Command::new(binary));
        }
    }

    let script = env::var("TENDER_SIDECAR_SCRIPT").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join("packages/sidecar/dist/server.js")
    });
    if !script.exists() {
        return Err(format!(
            "sidecar build not found at {}. Run `npm run build:sidecar`, or set TENDER_SIDECAR_BIN for a packaged sidecar.",
            script.display()
        ));
    }
    let mut command = Command::new(env::var("TENDER_NODE_BIN").unwrap_or_else(|_| "node".to_string()));
    command.arg(script);
    Ok(command)
}

fn redact(text: String, bot_id: &str, secret: &str) -> String {
    text.replace(bot_id, "[REDACTED_BOT_ID]")
        .replace(secret, "[REDACTED_BOT_SECRET]")
}

fn call_sidecar_once(method: &str, params_value: Value, bot_id: &str, secret: &str) -> Result<Value, String> {
    let request = json!({
        "jsonrpc": "2.0",
        "id": Uuid::new_v4().to_string(),
        "method": method,
        "params": params_value,
    });
    let mut child = sidecar_command()?
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("unable to launch notification sidecar: {error}"))?;
    let line = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("{line}\n").as_bytes())
            .map_err(|error| format!("unable to send sidecar request: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("notification sidecar did not complete: {error}"))?;
    let stderr = redact(String::from_utf8_lossy(&output.stderr).into_owned(), bot_id, secret);
    if !output.status.success() {
        return Err(format!("notification sidecar failed: {}", stderr.trim()));
    }

    let stdout_text = String::from_utf8_lossy(&output.stdout).into_owned();
    let response_line = stdout_text
        .lines()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| format!("notification sidecar returned no response: {}", stderr.trim()))?;
    let response: Value = serde_json::from_str(response_line)
        .map_err(|error| format!("invalid notification sidecar response: {error}"))?;
    if let Some(error) = response.get("error") {
        return Err(redact(error.to_string(), bot_id, secret));
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| "notification sidecar result is missing".to_string())
}

fn wecom_credentials() -> Result<(String, String), String> {
    Ok((
        get_keychain_value(WECOM_BOT_ID_ACCOUNT)?,
        get_keychain_value(WECOM_BOT_SECRET_ACCOUNT)?,
    ))
}

#[tauri::command]
fn list_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let db = state.db.lock().map_err(|_| "database lock")?;
    let mut statement = db
        .prepare("SELECT t.id,t.name,t.status,t.created_at,COUNT(i.id) FROM tasks t LEFT JOIN task_items i ON i.task_id=t.id GROUP BY t.id ORDER BY t.created_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                name: row.get(1)?,
                status: row.get(2)?,
                created_at: row.get(3)?,
                query_count: row.get(4)?,
                platform_count: 9,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
}

#[tauri::command]
fn create_task(input: CreateTaskInput, state: State<AppState>) -> Result<Task, String> {
    if input.name.trim().is_empty() || input.queries.is_empty() {
        return Err("任务名称和查询名称不能为空".into());
    }
    let id = Uuid::new_v4().to_string();
    let created_at = now();
    let db = state.db.lock().map_err(|_| "database lock")?;
    db.execute(
        "INSERT INTO tasks(id,name,status,privacy_mode,created_at) VALUES(?1,?2,'queued',?3,?4)",
        params![id, input.name, input.privacy_mode, created_at],
    )
    .map_err(|error| error.to_string())?;
    for query in &input.queries {
        db.execute(
            "INSERT INTO task_items(id,task_id,query_name) VALUES(?1,?2,?3)",
            params![Uuid::new_v4().to_string(), id, query],
        )
        .map_err(|error| error.to_string())?;
    }
    log_event(&db, Some(&id), "INFO", "task_created")?;
    Ok(Task {
        id,
        name: input.name,
        status: "queued".into(),
        created_at,
        query_count: input.queries.len() as i64,
        platform_count: input.platform_ids.len() as i64,
    })
}

#[tauri::command]
fn start_task(task_id: String, state: State<AppState>) -> Result<(), String> {
    let db = state.db.lock().map_err(|_| "database lock")?;
    db.execute("UPDATE tasks SET status='running' WHERE id=?1", params![task_id])
        .map_err(|error| error.to_string())?;
    log_event(&db, Some(&task_id), "INFO", "task_execution_requested")
}

#[tauri::command]
fn get_wecom_bot_status(state: State<AppState>) -> Result<WeComBotStatus, String> {
    let db = state.db.lock().map_err(|_| "database lock")?;
    let profile = load_wecom_profile(&db)?;
    let configured = get_keychain_value(WECOM_BOT_ID_ACCOUNT).is_ok()
        && get_keychain_value(WECOM_BOT_SECRET_ACCOUNT).is_ok();
    Ok(match profile {
        Some(profile) => WeComBotStatus {
            configured,
            enabled: profile.enabled,
            target_count: profile.target_chat_ids.len(),
            websocket_url: profile.websocket_url,
            updated_at: Some(profile.updated_at),
        },
        None => WeComBotStatus {
            configured,
            enabled: false,
            target_count: 0,
            websocket_url: None,
            updated_at: None,
        },
    })
}

#[tauri::command]
fn configure_wecom_bot(input: ConfigureWeComBotInput, state: State<AppState>) -> Result<WeComBotStatus, String> {
    let bot_id = input.bot_id.trim();
    let secret = input.secret.trim();
    if bot_id.is_empty() || secret.is_empty() {
        return Err("Bot ID 和 Bot Secret 不能为空".into());
    }
    let target_chat_ids = normalize_targets(input.target_chat_ids);
    let websocket_url = input.websocket_url.and_then(|value| (!value.trim().is_empty()).then(|| value.trim().to_string()));
    let enabled = input.enabled.unwrap_or(true);

    set_keychain_value(WECOM_BOT_ID_ACCOUNT, bot_id)?;
    set_keychain_value(WECOM_BOT_SECRET_ACCOUNT, secret)?;
    let db = state.db.lock().map_err(|_| "database lock")?;
    db.execute(
        "INSERT INTO notification_profiles(id,transport,enabled,target_chat_ids_json,websocket_url,updated_at) VALUES(?1,'wecom-bot-id-secret',?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET transport=excluded.transport,enabled=excluded.enabled,target_chat_ids_json=excluded.target_chat_ids_json,websocket_url=excluded.websocket_url,updated_at=excluded.updated_at",
        params![
            WECOM_PROFILE_ID,
            if enabled { 1_i64 } else { 0_i64 },
            serde_json::to_string(&target_chat_ids).map_err(|error| error.to_string())?,
            websocket_url,
            now()
        ],
    )
    .map_err(|error| error.to_string())?;
    log_event(&db, None, "INFO", "wecom_bot_credentials_saved_to_keychain")?;
    Ok(WeComBotStatus {
        configured: true,
        enabled,
        target_count: target_chat_ids.len(),
        websocket_url,
        updated_at: Some(now()),
    })
}

#[tauri::command]
fn test_wecom_bot(state: State<AppState>) -> Result<Value, String> {
    let db = state.db.lock().map_err(|_| "database lock")?;
    let profile = load_wecom_profile(&db)?.ok_or_else(|| "企业微信 Bot 尚未配置".to_string())?;
    let (bot_id, secret) = wecom_credentials()?;
    let result = call_sidecar_once(
        "wecom.bot.testConnection",
        json!({
            "botId": &bot_id,
            "secret": &secret,
            "websocketUrl": profile.websocket_url,
            "connectTimeoutMs": 15000,
            "correlationId": Uuid::new_v4().to_string()
        }),
        &bot_id,
        &secret,
    )?;
    log_event(&db, None, "INFO", "wecom_bot_connection_test_authenticated")?;
    Ok(result)
}

#[tauri::command]
fn send_wecom_bot_markdown(input: SendWeComBotMarkdownInput, state: State<AppState>) -> Result<Value, String> {
    let markdown = input.markdown.trim();
    if markdown.is_empty() {
        return Err("通知内容不能为空".into());
    }
    let db = state.db.lock().map_err(|_| "database lock")?;
    let profile = load_wecom_profile(&db)?.ok_or_else(|| "企业微信 Bot 尚未配置".to_string())?;
    if !profile.enabled {
        return Err("企业微信 Bot 通知当前已禁用".into());
    }
    let targets = input
        .target_chat_ids
        .map(normalize_targets)
        .unwrap_or_else(|| profile.target_chat_ids.clone());
    if targets.is_empty() {
        return Err("请配置至少一个企业微信会话 ID".into());
    }
    let (bot_id, secret) = wecom_credentials()?;
    let result = call_sidecar_once(
        "wecom.bot.sendMarkdown",
        json!({
            "botId": &bot_id,
            "secret": &secret,
            "targetChatIds": targets,
            "markdown": markdown,
            "websocketUrl": profile.websocket_url,
            "connectTimeoutMs": 15000,
            "correlationId": Uuid::new_v4().to_string()
        }),
        &bot_id,
        &secret,
    )?;
    log_event(&db, None, "INFO", "wecom_bot_markdown_delivery_completed")?;
    Ok(result)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?.join("tender-screenshot-agent");
            app.manage(AppState { db: Mutex::new(init_db(&root)) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tasks,
            create_task,
            start_task,
            get_wecom_bot_status,
            configure_wecom_bot,
            test_wecom_bot,
            send_wecom_bot_markdown
        ])
        .run(tauri::generate_context!())
        .expect("tauri runtime error")
}
