package org.domterm.util;

import java.io.*;

public class StyleSheets {
    static Console console;

    public static void fatal(String message) {
        System.err.println(message);
        System.exit(-1);
    }
    static Console getConsole() {
        if (console == null)
            console = System.console();
        if (console == null)
            fatal("no console");
        return console;
    }

    public static void main(String[] args) throws IOException {
        for (int i = 0; i < args.length; ) {
            String arg = args[i++];
            if (arg.equals("--list"))
                listStyleSheets();
            else if (arg.equals("--disable") && i < args.length)
                maybeDisable(args[i++], true);
            else if (arg.equals("--enable") && i < args.length)
                maybeDisable(args[i++], false);
            else if (arg.equals("--add-rule") && i < args.length)
                addRule(args[i++]);
            else if (arg.equals("--add-rules") && i < args.length) {
		do {
		    addRule(args[i++]);
		} while (i < args.length);
	    }
            else if (arg.equals("--load-stylesheet") && i + 1 < args.length)
                loadStyleSheet(args[i++], args[i++]);
            else if (arg.equals("--print") && i < args.length)
                printStyleSheet(args[i++]);
            else
                fatal("unknown argument '"+arg+"'");
        }
    }
    public static String requestReponse(String request) throws IOException {
        FileOutputStream fout = new FileOutputStream("/dev/tty");
        Writer writer = new OutputStreamWriter(fout);
        writer.write(request);
        writer.flush();
        FileInputStream fin = new FileInputStream("/dev/tty");
        Reader reader = new InputStreamReader(fin); // FIXME specify UTF8
        BufferedReader breader = new BufferedReader(reader);
        breader.mark(1);
        int ch = breader.read();
        if (ch == 0x9D)
            return breader.readLine();
        if (ch >= 0)
            breader.reset();
        System.err.println("(no response received)");
        return "";
    }

    public static void addRule(String rule) {
        String command = "\u001B]94;"+Util.toJson(rule)+"\007";
        console = getConsole();
        console.format(command);
        console.flush();
    }

    public static String loadStyleSheetRequest(String name, String value) {
        return "\u001B]95;"+Util.toJson(name)+","+Util.toJson(value)+"\007";
    }

    public static void loadStyleSheet(String name, String fname) throws IOException {
        Reader in;
        char[] buf = new char[2048];
        int count = 0;
        if (fname.equals("-")) {
            in = new InputStreamReader(System.in);
        } else {
            in = new FileReader(fname);
        }
        for (;;) {
            int avail = buf.length - count;
            if (avail < 512) {
                char[] nbuf = new char[(buf.length * 3) >> 1];
                System.arraycopy(buf, 0, nbuf, 0, count);
                buf = nbuf;
                avail = buf.length - count;
            }
            int i = in.read(buf, count, avail);
            if (i < 0)
                break;
            count += i;
        }
        String value = new String(buf, 0, count);
        String command = loadStyleSheetRequest(name, value);
        String str = requestReponse(command);
        if (str != null && str.length() > 0) {
            System.err.println(str);
            System.exit(-1);
        }
    }

    public static void printStyleSheet(String specifier) throws IOException {
        String command = "\u001B]93;"+specifier+"\007";
        String str = requestReponse(command);
        int start = 0;
        int end = str.length();
        int[] endPos = new int[1];
        String line = Util.parseSimpleJsonString(str, start, end, endPos);
        if (line == null) {
            System.err.println(str);
        } else {
            for (;;) {
                if (line == null)
                    break;
                System.out.println(line);
                start = endPos[0] + 1;
                line = Util.parseSimpleJsonString(str, start, end, endPos);
            }
        }
    }
    public static void maybeDisable(String specifier, boolean disable) throws IOException {
        String command = "\u001B]"+(disable?91:92)+";"+specifier+"\007";
        String str = requestReponse(command);
        if (str != null && str.length() > 0) {
            System.err.println(str);
            System.exit(-1);
        }
    }
    public static void listStyleSheets() throws IOException {
        String str = requestReponse("\u001B]90;\007");
        int i = 0;
        int len = str.length();
        int start = 0;
        while (start < len) {
            int tab = str.indexOf('\t', start);
            if (tab < 0)
                tab = str.length();
            if (start == tab)
                break;
            System.out.print(""+i+": ");
            System.out.append(str, start, tab);
            System.out.println();
            start = tab + 1;
            i++;
        }
    }
}
