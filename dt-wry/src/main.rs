// Copyright 2021, 2022 Per Bothner
// Copyright 2019-2021 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: MIT

use serde_json::Value;
use std::collections::HashMap;
use std::env;use std::io::Write;
use std::io;
mod versions;

fn main() -> wry::Result<()> {
    // See https://wiki.archlinux.org/index.php/GTK#Disable_overlay_scrollbars
    env::set_var("GTK_OVERLAY_SCROLLING", "0");
    use wry::{
        application::{
            dpi::{LogicalSize, LogicalPosition},
            event::{Event, WindowEvent},
            event_loop::{ControlFlow, EventLoop, EventLoopProxy, EventLoopWindowTarget},
            window::{Window, WindowBuilder, WindowId},
        },
        webview::{WebView, WebViewBuilder},
    };
    use regex::Regex;

    enum UserEvents {
        CloseWindow(WindowId),
        Devtools(WindowId, String),
        NewWindow(serde_json::Map<String, Value>),
    }

    let args: Vec<String> = env::args().collect();
    let mut joptions = serde_json::json!({});
    let options = joptions.as_object_mut().unwrap();
    let mut iarg = 1;
    while iarg < args.len() {
        let arg = &args[iarg];
        if arg == "--titlebar" && iarg + 1 < args.len() {
            iarg += 1;
            options.insert("titlebar".to_string(),
                           serde_json::to_value(&args[iarg]).unwrap());
        } else if arg == "--window-number" && iarg + 1 < args.len() {
            iarg += 1;
            options.insert("windowNumber".to_string(),
                           serde_json::to_value(&args[iarg].parse::<i64>().unwrap()).unwrap());
        } else if arg == "--window-title" && iarg + 1 < args.len() {
            iarg += 1;
            options.insert("windowTitle".to_string(),
                           serde_json::to_value(&args[iarg]).unwrap());
        } else if arg == "--geometry" && iarg + 1 < args.len() {
            iarg += 1;
            let re = Regex::new(r"^(([0-9]+)x([0-9]+))?([-+][0-9]+[-+][0-9]+)?$").unwrap();
            if let Some(caps) = re.captures(&args[iarg]) {
                if let (Some(w),Some(h)) = (caps.get(2),caps.get(3)) {
                    options.insert("width".to_string(),
                                   serde_json::to_value(w.as_str().parse::<f64>().unwrap()).unwrap());
                    options.insert("height".to_string(),
                                   serde_json::to_value(h.as_str().parse::<f64>().unwrap()).unwrap());
                }
                if let Some(position) = caps.get(4) {
                    options.insert("position".to_string(), serde_json::to_value(position.as_str()).unwrap());
                }
            }
        } else {
            options.insert("url".to_string(), serde_json::to_value(arg).unwrap());
        }
        iarg += 1;
    }

    let event_loop = EventLoop::<UserEvents>::with_user_event();
    let mut webviews = HashMap::new();
    let proxy = event_loop.create_proxy();

    fn move_window(position: &str, window: &Window) -> () {
        let re = Regex::new(r"^([-+][0-9]+)([-+][0-9]+)$").unwrap();
        if let Some(caps) = re.captures(position) {
            let x = caps.get(1).unwrap().as_str().parse::<f32>().unwrap();
            let y = caps.get(2).unwrap().as_str().parse::<f32>().unwrap();
            // This doesn't work on Wayland.
            window.set_outer_position(LogicalPosition::new(x, y));
        }
    }

    fn create_new_window(
        options: &serde_json::Map<String, Value>,
        event_loop: &EventLoopWindowTarget<UserEvents>,
        proxy: EventLoopProxy<UserEvents>,
    ) -> (WindowId, WebView, i32) {
        let url = options["url"].as_str().unwrap();
        let wversion = wry::webview::webview_version();
        let titlebar = match options.get("titlebar") {
            Some(t) => t.as_str().unwrap_or("") == "system",
            None => false // default to "domterm" titlebar
        };
        let wversion_js = match wversion {
            Ok(v) => format!("    window.webview_version = \"{}\";\n", v),
            Err(_) => "".to_string(),
        };

        let wry_version = versions::wry_version();
        let _domterm_version = versions::domterm_version();
        let script = format!(
            r#"
  (function () {{
{}{}    window.wry_version = "{}";
    window._dt_toggleDeveloperTools = () => {{ipc.postMessage("devtools toggle");}};
    window.closeMainWindow = ()=>{{window.close();}};
}})();
  "#,
            wversion_js,
            "window.setWindowTitle = (str)=>{ipc.postMessage('set-title '+str);}\n",
            wry_version
        );

        let window_number =
            if let Some(val) = options.get("windowNumber") {
                if let Some(wnum) = val.as_i64() {
                    wnum as i32
                } else {
                    -1
                }
            } else {
                -1
            };

        let title = match options.get("windowTitle") {
            Some(t) => t.as_str().unwrap_or("DomTerm").to_string(),
            None => format!("DomTerm{}: ({})",
                            if window_number > 0 { format!("#{}", window_number) } else { "".to_string() },
                            url)
        };

        let window = WindowBuilder::new()
            .with_title(title)
            .with_decorations(titlebar)
            .with_transparent(! titlebar)
            .build(event_loop)
            .unwrap();

        if let (Some(width),Some(height)) = (options.get("width"),options.get("height")) {
            if let (Some(w),Some(h)) = (width.as_f64(),height.as_f64()) {
                window.set_inner_size(LogicalSize::new(w, h));
            }
        }
        if let Some(Value::String(position)) = options.get("position") {
            move_window(position.as_str(), &window);
        }
        let window_id = window.id();
        let handler = move |window: &Window, req: String| {
            if let Some((cmd, data)) = req.split_once(' ') {
                if cmd == "set-title" {
                    window.set_title(data);
                }
                if cmd == "move-window" {
                    move_window(data, window);
                }
                if cmd == "new-window" {
                    if let Ok(Value::Object(options)) = serde_json::from_str(data) {
                        let _ = proxy.send_event(UserEvents::NewWindow(options));
                    } // else handle error FIXME
                }
                if cmd == "devtools" {
                    let _ = proxy.send_event(UserEvents::Devtools(window.id(), data.to_string()));
                }
            }

            // The following logic for minimize/hide/show is a bit weird,
            // but seems to what is needed to get things to work correctly.
            if req == "minimize" {
                if ! window.is_visible() {
                    if window.is_minimized() {
                        window.set_visible(false);
                        window.set_minimized(false);
                    }
                    window.set_visible(true);
                }
                window.set_minimized(true);
            } else if req == "hide" {
                window.set_visible(false);
                if window.is_minimized() {
                    window.set_minimized(false);
                }
            } else if req == "show" {
                if window.is_minimized() {
                    window.set_visible(false);
                    window.set_minimized(false);
                }
                window.set_visible(true);
                window.set_focus();
            }

            if req == "close" {
                let _ = proxy.send_event(UserEvents::CloseWindow(window.id()));
            }
            if req == "drag_window" {
                let _ = window.drag_window();
            }
        };

        let webview = WebViewBuilder::new(window)
            .unwrap()
            .with_url(&url)
            .unwrap()
            .with_initialization_script(&script)
            .with_ipc_handler(handler);
        #[cfg(debug_assertions)]
        let webview = webview.with_devtools(true);
        let webview = webview
            .build()
            .unwrap();

        (window_id, webview, window_number)
    }

    let window_triple = create_new_window(
        &options,
        // &script,
        &event_loop,
        proxy.clone(),
    );
    let window_number = window_triple.2;
    webviews.insert(window_triple.0, (window_triple.1, window_number));

    event_loop.run(move |event, event_loop, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event, window_id, ..
            } => match event {
                WindowEvent::CloseRequested => {
                    let (_, window_number) = &webviews[&window_id];
                    println!("CLOSE-WINDOW {}", window_number); io::stdout().flush().unwrap();
                    webviews.remove(&window_id);
                    #[cfg(not(target_os = "macos"))]
                    if webviews.is_empty() {
                        *control_flow = ControlFlow::Exit
                    }
                }
                _ => (),
            },
            Event::UserEvent(UserEvents::NewWindow(options)) => {
                let window_pair = create_new_window(
                    &options,
                    //          script,
                    &event_loop,
                    proxy.clone());
                webviews.insert(window_pair.0, (window_pair.1, window_pair.2));
            }
            Event::UserEvent(UserEvents::CloseWindow(id)) => {
                webviews.remove(&id);
                #[cfg(not(target_os = "macos"))]
                if webviews.is_empty() {
                    *control_flow = ControlFlow::Exit
                }
            }
            Event::UserEvent(UserEvents::Devtools(_id, _op)) => {
                #[cfg(debug_assertions)] {
                    let (webview, _) = &webviews[&_id];
                    if webview.is_devtools_open() {
                        webview.close_devtools();
                    } else {
                        webview.open_devtools();
                    }
                }
            }
            _ => (),
        }
    });
}
