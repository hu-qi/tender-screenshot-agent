use std::{env, fs, path::PathBuf};

fn main() {
    let path = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("icons/icon.png");
    if !path.exists() {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89\0\0\0\rIDAT\x08\x1dc\xf8\xcf\xc0\xf0\x1f\0\x05\x80\x02\x3fI\xc2\xe4\xd1\0\0\0\0IEND\xaeB\x60\x82").unwrap();
    }
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build()
}
