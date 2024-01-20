// Copyright 2021-2024 Per Bothner
// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use tao::{
  dpi::{LogicalPosition, LogicalSize},
  event::{Event, WindowEvent},
  event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget},
  window::{Icon, Window, WindowBuilder, WindowId},
};
use wry::{WebView, WebViewBuilder};
mod versions;

enum UserEvent {
  CloseWindow(WindowId),
  NewTitle(WindowId, String),
  WindowOp(WindowId, String),
  MoveWindow(WindowId, String),
  Devtools(WindowId, String),
  NewWindow(serde_json::Map<String, Value>),
}

const ICON_BYTES: &[u8] = include_bytes!("../../doc/domterm48.png");

fn main() -> wry::Result<()> {
  let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
  let mut webviews = HashMap::new();
  let proxy = event_loop.create_proxy();

  let args: Vec<String> = env::args().collect();
  let mut joptions = serde_json::json!({});
  let options = joptions.as_object_mut().unwrap();
  let mut iarg = 1;
  while iarg < args.len() {
    let arg = &args[iarg];
    if arg == "--titlebar" && iarg + 1 < args.len() {
      iarg += 1;
      options.insert(
        "titlebar".to_string(),
        serde_json::to_value(&args[iarg]).unwrap(),
      );
    } else if arg == "--window-number" && iarg + 1 < args.len() {
      iarg += 1;
      options.insert(
        "windowNumber".to_string(),
        serde_json::to_value(&args[iarg].parse::<i64>().unwrap()).unwrap(),
      );
    } else if arg == "--window-title" && iarg + 1 < args.len() {
      iarg += 1;
      options.insert(
        "windowTitle".to_string(),
        serde_json::to_value(&args[iarg]).unwrap(),
      );
    } else if arg == "--geometry" && iarg + 1 < args.len() {
      iarg += 1;
      let re = Regex::new(r"^(([0-9]+)x([0-9]+))?([-+][0-9]+[-+][0-9]+)?$").unwrap();
      if let Some(caps) = re.captures(&args[iarg]) {
        if let (Some(w), Some(h)) = (caps.get(2), caps.get(3)) {
          options.insert(
            "width".to_string(),
            serde_json::to_value(w.as_str().parse::<f64>().unwrap()).unwrap(),
          );
          options.insert(
            "height".to_string(),
            serde_json::to_value(h.as_str().parse::<f64>().unwrap()).unwrap(),
          );
        }
        if let Some(position) = caps.get(4) {
          options.insert(
            "position".to_string(),
            serde_json::to_value(position.as_str()).unwrap(),
          );
        }
      }
    } else {
      options.insert("url".to_string(), serde_json::to_value(arg).unwrap());
    }
    iarg += 1;
  }

  let new_window = create_new_window(&options, &event_loop, proxy.clone());
  let window_number = new_window.2;
  webviews.insert(new_window.0.id(), new_window);

  event_loop.run(move |event, event_loop, control_flow| {
    *control_flow = ControlFlow::Wait;

    match event {
      Event::WindowEvent {
        event: WindowEvent::CloseRequested,
        window_id,
        ..
      } => {
        webviews.remove(&window_id);
        if webviews.is_empty() {
          println!("CLOSE-WINDOW {}", window_number);
          *control_flow = ControlFlow::Exit
        }
      }
      Event::UserEvent(UserEvent::NewWindow(options)) => {
        let new_window = create_new_window(&options, event_loop, proxy.clone());
        webviews.insert(new_window.0.id(), new_window);
      }
      Event::UserEvent(UserEvent::CloseWindow(id)) => {
        webviews.remove(&id);
        if webviews.is_empty() {
          *control_flow = ControlFlow::Exit
        }
      }

      Event::UserEvent(UserEvent::NewTitle(id, title)) => {
        webviews.get(&id).unwrap().0.set_title(&title);
      }
      Event::UserEvent(UserEvent::Devtools(_id, _op)) => {
        #[cfg(debug_assertions)]
        {
          let (_, webview, _) = &webviews[&_id];
          if webview.is_devtools_open() {
            webview.close_devtools();
          } else {
            webview.open_devtools();
          }
        }
      }
      Event::UserEvent(UserEvent::MoveWindow(id, data)) => {
        let window = &webviews.get(&id).unwrap().0;
        move_window(data.as_str(), window);
      }
      Event::UserEvent(UserEvent::WindowOp(id, op)) => {
        let window = &webviews.get(&id).unwrap().0;
        match op.as_str() {
          "hide" => {
            window.set_visible(false);
            if window.is_minimized() {
              window.set_minimized(false);
            }
          }
          "show" => {
            // Work around Wayland issue - otherwise show following
            // a minimize doesn't work.
            // Perhaps better to use: gtk::gdk::Display::default().unwrap().backend().is_wayland()
            // See Wry mutiwebview example.
            if !env::var("WAYLAND_DISPLAY").unwrap_or_default().is_empty() || window.is_minimized()
            {
              window.set_visible(false);
              window.set_minimized(false);
            }
            window.set_visible(true);
            window.set_focus();
          }
          "minimize" => {
            if !window.is_visible() {
              if window.is_minimized() {
                window.set_visible(false);
                window.set_minimized(false);
              }
              window.set_visible(true);
            }
            window.set_minimized(true)
          }
          _ => {}
        }
      }
      _ => (),
    }
  });
}

fn create_new_window(
  options: &serde_json::Map<String, Value>,
  event_loop: &EventLoopWindowTarget<UserEvent>,
  proxy: EventLoopProxy<UserEvent>,
) -> (Window, WebView, i32) {
  let url = options["url"].as_str().unwrap();
  let wversion = wry::webview_version();
  let titlebar = match options.get("titlebar") {
    Some(t) => t.as_str().unwrap_or("") == "system",
    None => true, // default to "system" titlebar
  };
  let wversion_js = match wversion {
    Ok(v) => format!("    window.webview_version = \"{}\";\n", v),
    Err(_) => "".to_string(),
  };

  let wry_version = versions::wry_version();
  let _domterm_version = versions::domterm_version();
  let script = format!(
    r#"
{}{}    window.wry_version = "{}";
  (function () {{
    window._dt_toggleDeveloperTools = () => {{ipc.postMessage("devtools toggle");}};
    window.closeMainWindow = ()=>{{ipc.postMessage('close');}};
}})();
   "#,
    wversion_js,
    "window.setWindowTitle = (str)=>{ipc.postMessage('set-title '+str);}\n",
    wry_version
  );

  let window_number = if let Some(val) = options.get("windowNumber") {
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
    None => format!(
      "DomTerm{}: ({})",
      if window_number > 0 {
        format!("#{}", window_number)
      } else {
        "".to_string()
      },
      url
    ),
  };

  let window = WindowBuilder::new()
    .with_title(title)
    .with_decorations(titlebar)
    .with_transparent(!titlebar)
    .build(event_loop)
    .unwrap();
  let icon_buffer =
    image::load_from_memory_with_format(&ICON_BYTES.to_vec(), image::ImageFormat::Png)
      .unwrap()
      .into_rgba8();
  let (icon_width, icon_height) = icon_buffer.dimensions();
  let icon_rgba = icon_buffer.into_raw();
  window.set_window_icon(Some(
    Icon::from_rgba(icon_rgba, icon_width, icon_height).unwrap(),
  ));

  if let (Some(width), Some(height)) = (options.get("width"), options.get("height")) {
    if let (Some(w), Some(h)) = (width.as_f64(), height.as_f64()) {
      window.set_inner_size(LogicalSize::new(w, h));
    }
  }
  if let Some(Value::String(position)) = options.get("position") {
    move_window(position.as_str(), &window);
  }
  let window_id = window.id();
  let handler = move |req: String| {
    match req.split_once(' ').unwrap_or((&req, "")) {
      ("set-title", data) => {
        let _ = proxy.send_event(UserEvent::NewTitle(window_id, data.to_string()));
      }
      ("new-window", data) => {
        if let Ok(Value::Object(options)) = serde_json::from_str(data) {
          let _ = proxy.send_event(UserEvent::NewWindow(options));
        } // else handle error FIXME
      }
      ("move-window", data) => {
        let _ = proxy.send_event(UserEvent::MoveWindow(window_id, data.to_string()));
      }
      ("hide" | "show" | "minimize" | "maximize", _) => {
        let _ = proxy.send_event(UserEvent::WindowOp(window_id, req));
      }
      ("devtools", data) => {
        let _ = proxy.send_event(UserEvent::Devtools(window_id, data.to_string()));
      }
      ("close", _) => {
        let _ = proxy.send_event(UserEvent::CloseWindow(window_id));
      }
      _ => {}
    }
    /*
             if req == "drag_window" {
                 let _ = window.drag_window();
    }
    */
  };
  #[cfg(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "ios",
    target_os = "android"
  ))]
  let builder = WebViewBuilder::new(&window);

  #[cfg(not(any(
    target_os = "windows",
    target_os = "macos",
    target_os = "ios",
    target_os = "android"
  )))]
  let builder = {
    use tao::platform::unix::WindowExtUnix;
    use wry::WebViewBuilderExtUnix;
    let vbox = window.default_vbox().unwrap();
    WebViewBuilder::new_gtk(vbox)
  };
  let webview = builder
    .with_url(&url)
    .unwrap()
    .with_initialization_script(&script)
    .with_clipboard(true)
    .with_ipc_handler(handler)
    .build()
    .unwrap();
  (window, webview, window_number)
}

fn move_window(position: &str, window: &Window) -> () {
  let re = Regex::new(r"^([-+][0-9]+)([-+][0-9]+)$").unwrap();
  if let Some(caps) = re.captures(position) {
    let x = caps.get(1).unwrap().as_str().parse::<f32>().unwrap();
    let y = caps.get(2).unwrap().as_str().parse::<f32>().unwrap();
    // This doesn't work on Wayland.
    window.set_outer_position(LogicalPosition::new(x, y));
  }
}
