use serde::Serialize;
use std::{
    env,
    io,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, State};
use uuid::Uuid;

struct AgentHostState {
    base_url: String,
    token: String,
    child: Mutex<Option<Child>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentHostConfig {
    base_url: String,
    token: String,
}

fn reserve_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    drop(listener);
    Ok(port)
}

fn agent_host_script() -> PathBuf {
    if let Ok(path) = env::var("TENDER_AGENT_HOST_SCRIPT") {
        return PathBuf::from(path);
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("packages/agent-host/dist/index.js")
}

fn start_agent_host(app: &tauri::App) -> Result<AgentHostState, String> {
    let port = reserve_loopback_port()?;
    let token = Uuid::new_v4().to_string();
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("agent-host");
    let config_dir = app.path().app_config_dir().map_err(|error| error.to_string())?.join("agent-host");
    let host_binary = env::var("TENDER_AGENT_HOST_BIN").ok().filter(|value| !value.trim().is_empty());

    let mut command = if let Some(binary) = host_binary {
        Command::new(binary)
    } else {
        let script = agent_host_script();
        if !script.exists() {
            return Err(format!(
                "Agent Host build is missing at {}. Run `npm run build:agent-host` before starting the desktop app.",
                script.display()
            ));
        }
        let node = env::var("TENDER_NODE_BIN").unwrap_or_else(|_| "node".to_string());
        let mut command = Command::new(node);
        command.arg(script);
        command
    };

    let port_arg = port.to_string();
    let data_dir_arg = data_dir.to_string_lossy().into_owned();
    let config_dir_arg = config_dir.to_string_lossy().into_owned();
    let child = command
        .arg("--port")
        .arg(&port_arg)
        .arg("--token")
        .arg(&token)
        .arg("--data-dir")
        .arg(&data_dir_arg)
        .arg("--config-dir")
        .arg(&config_dir_arg)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("unable to start Agent Host: {error}"))?;

    Ok(AgentHostState {
        base_url: format!("http://127.0.0.1:{port}"),
        token,
        child: Mutex::new(Some(child)),
    })
}

#[tauri::command]
fn agent_host_config(state: State<AgentHostState>) -> AgentHostConfig {
    AgentHostConfig {
        base_url: state.base_url.clone(),
        token: state.token.clone(),
    }
}

fn stop_agent_host(app: &tauri::AppHandle) {
    let state = app.state::<AgentHostState>();
    if let Ok(mut child) = state.child.lock() {
        if let Some(mut process) = child.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let host = start_agent_host(app).map_err(io::Error::other)?;
            app.manage(host);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_host_config])
        .run(tauri::generate_context!(), |app, event| {
            if matches!(event, tauri::RunEvent::Exit { .. } | tauri::RunEvent::ExitRequested { .. }) {
                stop_agent_host(app);
            }
        })
        .expect("tauri runtime error");
}
