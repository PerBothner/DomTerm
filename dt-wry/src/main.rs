// Copyright 2019-2021 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT


use std::env;

fn main() -> wry::Result<()> {
  use wry::{
    application::{
      event::{Event, WindowEvent},
      event_loop::{ControlFlow, EventLoop},
      window::{Window, WindowBuilder},
    },
    webview::{RpcRequest, WebViewBuilder},
  };

  let event_loop = EventLoop::new();
  let mut webviews = std::collections::HashMap::new();
  let window = WindowBuilder::new()
//    .with_decorations(false) remove titlebar
    .build(&event_loop)
    .unwrap();
  let args: Vec<String> = env::args().collect();
  let url = &args[1];

  let script = r#"
  (function () {
    window.wry_version = "x.x.x"; // TODO
  })();
  "#;

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
    .with_initialization_script(script)
    .with_rpc_handler(handler)
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
