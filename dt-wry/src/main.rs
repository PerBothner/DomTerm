// Copyright 2021 Per Bothner
// Copyright 2019-2021 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: MIT

use std::env;
use std::collections::HashMap;
mod versions;

fn main() -> wry::Result<()> {
  // See https://wiki.archlinux.org/index.php/GTK#Disable_overlay_scrollbars
  env::set_var("GTK_OVERLAY_SCROLLING", "0");
  use wry::{
    application::{
      event::{Event, WindowEvent},
      event_loop::{ControlFlow, EventLoop},
      window::{Window, WindowId, WindowBuilder},
    },
    webview::{WebContext, WebViewBuilder},
  };

  enum UserEvents {
    CloseWindow(WindowId),
    NewWindow()
  }

  let args: Vec<String> = env::args().collect();
  let mut url:&str = "-missing-";
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

  let event_loop = EventLoop::<UserEvents>::with_user_event();
  let mut web_context = WebContext::default();
  let mut webviews = HashMap::new();

  let wversion = wry::webview::webview_version();
  let wversion_js = match wversion {
     Ok(v) => format!("    window.webview_version = \"{}\";\n", v),
     Err(_) => "".to_string()
  };
  let wry_version = versions::wry_version();
  let _domterm_version = versions::domterm_version();

  let script = format!(r#"
  (function () {{
{}{}    window.wry_version = "{}";
    window.openNewWindow = (options)=>{{ipc.postMessage("new-window", options);}}
    window.closeMainWindow = ()=>{{window.close();}};
}})();
  "#,
  wversion_js,
  if titlebar {
    "window.setWindowTitle = (str)=>{ipc.postMessage('set-title '+str);}\n"
  } else {
    ""
  },
  wry_version);

  let mut new_window = |url: &str| -> wry::Result<()> {
    let window = WindowBuilder::new()
      .with_title("DomTerm")
      .with_decorations(titlebar)
      .build(&event_loop)
      .unwrap();

    let proxy = event_loop.create_proxy();

    let handler = move |window: &Window, req: String| {
      if let Some((cmd,rest)) = req.split_once(' ') {
        if cmd == "set-title" {
          window.set_title(rest);
        }
      }
      if req == "new-window" {
        let _ = proxy.send_event(UserEvents::NewWindow());
      }
      if req == "minimize" {
        window.set_minimized(true);
      }
      if req == "hide" {
        window.set_minimized(true);
        window.set_visible(false);
      }
      if req == "show" {
        window.set_visible(false);
        window.set_visible(true);
        window.set_minimized(false);
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
      .with_url(&url)?
      .with_initialization_script(&script)
      .with_ipc_handler(handler)
      .with_web_context(&mut web_context)
      .build()?;
    webviews.insert(webview.window().id(), webview);
    Ok(())
  };
  let _ = new_window(url);

  event_loop.run(move |event, _, control_flow| {
    *control_flow = ControlFlow::Wait;

   match event {
      Event::WindowEvent {
        event, window_id, ..
      } => match event {
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
      },
      Event::UserEvent(UserEvents::NewWindow()) => {
        // FIXME - fails to compile
        // new_window("http://example.com");
      },
      Event::UserEvent(UserEvents::CloseWindow(id)) => {
        webviews.remove(&id);
        if webviews.is_empty() {
          *control_flow = ControlFlow::Exit
        }
      }
      _ => (),
    }
  });
}
