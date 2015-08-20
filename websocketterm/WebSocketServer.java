// Inspired/based on:
// https://blog.openshift.com/how-to-build-java-websocket-applications-using-the-jsr-356-api/

package websocketterm;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import org.glassfish.tyrus.server.Server;
 
public class WebSocketServer {
 
    static String[] defaultArgs = { "/bin/bash" };

    public static void main(String[] args) {
        runServer();
    }
 
    public static void runServer() {
        Server server = new Server("localhost", 8025, "/websocket", null, ReplServer.class);
        System.err.println("server :"+server);
        try {
            server.start();
            BufferedReader reader = new BufferedReader(new InputStreamReader(System.in));
            System.out.print("Please press a key to stop the server.");
            reader.readLine();
        } catch (Exception e) {
            e.printStackTrace();
            throw new RuntimeException(e);
        } catch (Throwable e) {
            e.printStackTrace();
            throw new RuntimeException(e);
        } finally {
            server.stop();
        }
    }
}
