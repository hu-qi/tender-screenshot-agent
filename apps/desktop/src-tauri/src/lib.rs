use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use uuid::Uuid;

struct AppState { db: Mutex<Connection>, root: PathBuf }
#[derive(Debug, Serialize)] struct Task { id:String, name:String, status:String, created_at:String, query_count:i64, platform_count:i64 }
#[derive(Debug, Deserialize)] #[serde(rename_all="camelCase")] struct CreateTaskInput { name:String, queries:Vec<String>, platform_ids:Vec<String>, privacy_mode:String }

fn init_db(root:&PathBuf)->Connection { fs::create_dir_all(root).expect("create data directory"); let db=Connection::open(root.join("tender-agent.db")).expect("open sqlite"); db.execute_batch("CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,name TEXT NOT NULL,status TEXT NOT NULL,privacy_mode TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS task_items(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,query_name TEXT NOT NULL); CREATE TABLE IF NOT EXISTS event_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,level TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL);").expect("migrate"); db }

#[tauri::command] fn list_tasks(state:State<AppState>)->Result<Vec<Task>,String>{ let db=state.db.lock().map_err(|_|"database lock")?; let mut st=db.prepare("SELECT t.id,t.name,t.status,t.created_at,COUNT(i.id) query_count FROM tasks t LEFT JOIN task_items i ON i.task_id=t.id GROUP BY t.id ORDER BY t.created_at DESC").map_err(|e|e.to_string())?; let rows=st.query_map([],|r|Ok(Task{id:r.get(0)?,name:r.get(1)?,status:r.get(2)?,created_at:r.get(3)?,query_count:r.get(4)?,platform_count:9})).map_err(|e|e.to_string())?; rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string()) }

#[tauri::command] fn create_task(input:CreateTaskInput,state:State<AppState>)->Result<Task,String>{ if input.name.trim().is_empty()||input.queries.is_empty(){return Err("任务名称和查询名称不能为空".into())}; let id=Uuid::new_v4().to_string(); let now=Utc::now().to_rfc3339(); let db=state.db.lock().map_err(|_|"database lock")?; db.execute("INSERT INTO tasks(id,name,status,privacy_mode,created_at) VALUES(?1,?2,'queued',?3,?4)",params![id,input.name,input.privacy_mode,now]).map_err(|e|e.to_string())?; for q in &input.queries{db.execute("INSERT INTO task_items(id,task_id,query_name) VALUES(?1,?2,?3)",params![Uuid::new_v4().to_string(),id,q]).map_err(|e|e.to_string())?;} db.execute("INSERT INTO event_logs(task_id,level,message,created_at) VALUES(?1,'INFO','task_created',?2)",params![id,now]).map_err(|e|e.to_string())?; Ok(Task{id,name:input.name,status:"queued".into(),created_at:now,query_count:input.queries.len() as i64,platform_count:input.platform_ids.len() as i64}) }

#[tauri::command] fn start_task(task_id:String,state:State<AppState>)->Result<(),String>{ let db=state.db.lock().map_err(|_|"database lock")?; let now=Utc::now().to_rfc3339(); db.execute("UPDATE tasks SET status='running' WHERE id=?1",params![task_id]).map_err(|e|e.to_string())?; db.execute("INSERT INTO event_logs(task_id,level,message,created_at) VALUES(?1,'INFO','task_execution_requested: sidecar must validate account session before portal access',?2)",params![task_id,now]).map_err(|e|e.to_string())?; Ok(()) }

pub fn run(){tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(|app|{let root=app.path().app_data_dir()?.join("tender-screenshot-agent");let db=init_db(&root);app.manage(AppState{db:Mutex::new(db),root});Ok(())}).invoke_handler(tauri::generate_handler![list_tasks,create_task,start_task]).run(tauri::generate_context!()).expect("tauri runtime error")}
