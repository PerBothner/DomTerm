// Inspired by / based on:
// http://architects.dzone.com/articles/sample-java-web-socket-client

package websocketterm;
//package websocket.server;

import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import javax.websocket.*;
import javax.websocket.server.*;
import ptyconsole.PTY;
import org.domterm.util.Util;

@ServerEndpoint("/replsrv")
public class ReplServer {
 //queue holds the list of connected clients
 private static Queue<Session> queue = new ConcurrentLinkedQueue<Session>();

    static PTY pty;
    static int verbose;
 
    static Writer pin;
    static Reader pout;
    static String[] defaultArgs = { "/bin/bash" };

static
 {
     String[] childArgs = defaultArgs;
     pty = new PTY(childArgs, "domterm");
     try {
         pin = new OutputStreamWriter(pty.toChildInput);
         pout = new InputStreamReader(pty.fromChildOutput, "UTF-8");
     }
     catch (Throwable ex) {
         ex.printStackTrace();
         System.exit(-1);
     }
     pty.setWindowSize(24, 80, 80*7, 24*10); // FIXME
     
     Thread replThread=new Thread(){
             public void run() {
                 char[] buffer = new char[1024];
                 for (;;) {
                     int n;
                     try {
                         n = pout.read(buffer);
                     } catch (Throwable ex) {
                         System.out.println("caught "+ex);
                         break;
                     }
                     if (verbose > 0)
                         System.out.println("got "+n+" chars");
                     if (n < 0)
                         break; // FIXME
                     sendAll(new String(buffer, 0, n));
                 }
             };
         };
     replThread.start();
 }

    /** for debugging */
    public static String quoteString(String str) {
        if (str == null)
            return "(null)";
        StringBuilder sbuf = new StringBuilder();
        for (int i = 0;  i < str.length();  i++) {
            char ch = str.charAt(i);
            switch (ch) {
            case '\n': sbuf.append("\\n"); break;
            case '\r': sbuf.append("\\r"); break;
            case '\b': sbuf.append("\\b"); break;
            case 27: sbuf.append("\\E"); break;
            default:
                if (ch < ' ' || ch >= 127)
                    sbuf.append("\\u"+Integer.toHexString(ch));
                else
                    sbuf.append(ch);
            }
        }
        return sbuf.toString();
    }
 
    String pending = null;

 @OnMessage
 public void onMessage(Session session, String msg) {
  try {   
      if (verbose > 0)
          System.out.println("received msg ["+quoteString(msg)+"] from "+session.getId());
      if (pending != null) {
          msg = pending + msg;
          pending = null;
      }
      int i = 0;
      int len = msg.length();
      for (; i < len; i++) {
          // Octal 222 is 0x92 "Private Use 2".
          if (msg.charAt(i) == '\222') {
              pin.write(msg.substring(0, i));
              int eol = msg.indexOf('\n', i+1);
              if (eol >= 0) {
                  String cmd = msg.substring(i+1, eol);
                  processEvent(session, cmd);
                  msg = msg.substring(eol+1);
                  i = -1;
                  len = msg.length();
              } else {
                  pending = msg.substring(i);
                  msg = "";
                  i = -1;
                  len = 0;
              }
          }
      }
   pin.write(msg);
   pin.flush();
  } catch (Exception e) {
   e.printStackTrace();
  }
 }

    public void processEvent(Session session, String str) {
        String[] words = str.split("  *");
        if (words.length == 5 && "WS".equals(words[0])) {
            try {
                int i1 = Integer.parseInt(words[1]);
                int i2 = Integer.parseInt(words[2]);
                int i3 = Integer.parseInt(words[3]);
                int i4 = Integer.parseInt(words[4]);
                pty.setWindowSize(i1, i2, i3, i3);
            } catch (Throwable ex) {
                System.err.println("caught "+ex);
            }
            if (verbose > 0)
                System.err.println("event/WS "+words[1]+"/"+words[2]+"/"+words[3]+"/"+words[4]);
        }
        else if ("KEY".equals(words[0])) {
            int mode = pty.getTtyMode();
            int q = str.indexOf('"');
            String kstr = Util.parseSimpleJsonString(str, q, str.length());
            boolean canonical = (mode & 1) != 0;
            if (canonical) {
                try {
                    session.getBasicRemote()
                        .sendText("\033]74;"+str.substring(4)+"\007");
                } catch (IOException ex) {
                    throw new RuntimeException(ex);
                }
            } else
                onMessage(session, kstr);
        } else
            System.out.println("event ["+quoteString(str)+"] "+words.length+" words");
    }

 @OnOpen
 public void open(Session session) {
  queue.add(session);
  System.out.println("New session opened: "+session.getId());
 }

  @OnError
 public void error(Session session, Throwable t) {
  queue.remove(session);
  System.err.println("Error on session "+session.getId());  
 }

 @OnClose
 public void closedConnection(Session session) { 
  queue.remove(session);
  String msg = "session closed: "+session.getId();
  if (verbose > 0)
      new Error(msg).printStackTrace();
  else
      System.out.println(msg);
 }
 
 private static void sendAll(String msg) {
  try {
   /* Send the new rate to all open WebSocket sessions */  
   ArrayList<Session > closedSessions= new ArrayList<>();
   for (Session session : queue) {
    if(!session.isOpen())
    {
     System.err.println("Closed session: "+session.getId());
     closedSessions.add(session);
    }
    else
    {
     session.getBasicRemote().sendText(msg);
    }    
   }
   queue.removeAll(closedSessions);
   if (verbose > 0)
       System.out.println("Sending ["+quoteString(msg)+"] to "+queue.size()+" clients");
  } catch (Throwable e) {
   e.printStackTrace();
  }
 }
}
