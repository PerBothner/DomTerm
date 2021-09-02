// Copyright 2019-2021 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT


use std::env;
mod versions;

fn main() -> wry::Result<()> {
  use wry::{
    application::{
      event::{Event, WindowEvent},
      event_loop::{ControlFlow, EventLoop},
      window::{Window, WindowBuilder},
    },
    webview::{RpcRequest, WebContext, WebViewBuilder},
  };

  let event_loop = EventLoop::new();
  let mut web_context = WebContext::default();
  let mut webviews = std::collections::HashMap::new();
  let window = WindowBuilder::new()
//    .with_decorations(false) remove titlebar
    .build(&event_loop)
    .unwrap();
  let args: Vec<String> = env::args().collect();
  let url = &args[1];

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
}})();
  "#, wversion_js, wry_version);
println!("script: {}", script);

  let (window_tx, window_rx) = std::sync::mpsc::channel();

  let handler = move |window: &Window, req: RpcRequest| {
    if req.method == "close" {
      let _ = window_tx.send(window.id());
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
