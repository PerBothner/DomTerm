// Copyright 2021 Per Bothner
// Copyright 2019-2021 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT


use std::env;
mod versions;

fn main() -> wry::Result<()> {
  // See https://wiki.archlinux.org/index.php/GTK#Disable_overlay_scrollbars
  env::set_var("GTK_OVERLAY_SCROLLING", "0");
  use wry::{
    application::{
      event::{Event, WindowEvent},
      event_loop::{ControlFlow, EventLoop},
      window::{Window, WindowBuilder},
    },
    webview::{RpcRequest, WebContext, WebViewBuilder},
  };

  let args: Vec<String> = env::args().collect();
  let mut url = "-missing-";
  let mut iarg = 1;
  let mut titlebar = true;
  while iarg < args.len() {
      let arg = &args[iarg];
      if arg == "--no-titlebar" {
         titlebar = false;
      } else {
          url = arg;
      }
      iarg += 1;
  }

  let event_loop = EventLoop::new();
  let mut web_context = WebContext::default();
  let mut webviews = std::collections::HashMap::new();

  let window = WindowBuilder::new()
    .with_decorations(titlebar)
    .build(&event_loop)
    .unwrap();
  let wversion = wry::webview::webview_version();
  let wversion_js = match wversion {
     Ok(v) => format!("    window.webview_version = \"{}\";\n", v),
     Err(_) => "".to_string()
  };
  let wry_version = versions::wry_version();
  let _domterm_version = versions::domterm_version();
  //let wversion = match wry::webview::webview_version() {
  //  Ok(v) => v, Err(e) => "?" };
  //wry::application
  let script = format!(r#"
  (function () {{
{}    window.wry_version = "{}";
    window.closeMainWindow = ()=>{{window.close();}};
}})();
  "#, wversion_js, wry_version);

  let (window_tx, window_rx) = std::sync::mpsc::channel();

  let handler = move |window: &Window, req: RpcRequest| {
    if req.method == "minimize" {
      window.set_minimized(true);
    }
    if req.method == "hide" {
      window.set_minimized(true);
      window.set_visible(false);
    }
    if req.method == "show" {
      window.set_visible(false);
      window.set_visible(true);
      window.set_minimized(false);
      window.set_focus();
    }
    if req.method == "close" {
      let _ = window_tx.send(window.id());
    }
    if req.method == "drag_window" {
      let _ = window.drag_window();
    }
    None
  };

  let webview = WebViewBuilder::new(window)
    .unwrap()
    .with_url(url)?
    .with_initialization_script(&script)
    .with_rpc_handler(handler)
    .with_web_context(&mut web_context)
    .build()?;
  webviews.insert(webview.window().id(), webview);

  event_loop.run(move |event, _, control_flow| {
    *control_flow = ControlFlow::Wait;
    if let Ok(id) = window_rx.try_recv() {
      webviews.remove(&id);
      if webviews.is_empty() {
        *control_flow = ControlFlow::Exit
      }
    }

    if let Event::WindowEvent {
      event, window_id, ..
    } = event
    {
      match event {
        WindowEvent::CloseRequested => {
          webviews.remove(&window_id);
          if webviews.is_empty() {
            *control_flow = ControlFlow::Exit
          }
        }
        WindowEvent::Resized(_) => {
          let _ = webviews[&window_id].resize();
        }
        _ => (),
      }
    }
  });
}
