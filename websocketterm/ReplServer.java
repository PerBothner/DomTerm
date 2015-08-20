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

@ServerEndpoint("/replsrv")
public class ReplServer {
 //queue holds the list of connected clients
 private static Queue<Session> queue = new ConcurrentLinkedQueue<Session>();

    static PTY pty;
 
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
 
 @OnMessage
 public void onMessage(Session session, String msg) {
  try {   
      System.out.println("received msg ["+quoteString(msg)+"] from "+session.getId());
   pin.write(msg);
   //pin.write("\r\n");
   pin.flush();
  } catch (Exception e) {
   e.printStackTrace();
  }
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
  System.out.println("session closed: "+session.getId());
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
   System.out.println("Sending ["+quoteString(msg)+"] to "+queue.size()+" clients");
  } catch (Throwable e) {
   e.printStackTrace();
  }
 }
}
