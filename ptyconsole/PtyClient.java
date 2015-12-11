/*
 * Copyright (c) 2015 Per Bothner.
 * Copyright (c) 2011, 2014 Oracle and/or its affiliates.
 * All rights reserved. Use is subject to license terms.
 *
 * This file is available and licensed under the following license:
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 *  - Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *  - Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in
 *    the documentation and/or other materials provided with the distribution.
 *  - Neither the name of Oracle Corporation nor the names of its
 *    contributors may be used to endorse or promote products derived
 *    from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

package ptyconsole;

import org.domterm.Client;
import org.domterm.util.WTDebug;
import java.io.*;

public class PtyClient extends Client {
    Writer pin;
    Reader pout;
    PTY pty;

    public PtyClient(String[] childArgs) {
        pty = new PTY(childArgs, "domterm");
        try {
            pin = new OutputStreamWriter(pty.toChildInput);
            pout = new InputStreamReader(pty.fromChildOutput, "UTF-8");
        }
        catch (Throwable ex) {
            ex.printStackTrace();
            System.exit(-1);
        }
    }

    Writer out_stream;
    @Override
    public void run(Writer out) {
        out_stream = out;
        copyThread(pout, out);
    }

    void copyThread(final Reader fromInferior, final Writer toPane) {
        Thread th = new Thread() {
                char[] buffer = new char[1024];
                public void run () {
                    for (;;) {
                        try {
                            int count = fromInferior.read(buffer);
                            if (count < 0)
                                break;
                            toPane.write(buffer, 0, count);
                        } catch (Throwable ex) {
                            ex.printStackTrace();
                            System.exit(-1);
                        }
                    }
                }
            };
        th.start();
    }

    @Override
    public void reportEvent(String name, String str) {
        if (verbosity > 0)
            System.err.println("PtyClient.reportEvent "+name+"["+WTDebug.toQuoted(str)+"]");
        if (name.equals("KEY")) {
            int mode = pty.getTtyMode();
            boolean canonical = (mode & 1) != 0;
            if (canonical) {
                try {
                    out_stream.write("\033]74;"+str+"\007");
                } catch (IOException ex) {
                    if (verbosity > 0)
                        System.err.println("PtyClient caught "+ex);        
                }
            } else {
                int q = str.indexOf('"');
                String kstr = Util.parseSimpleJsonString(str, q, str.length());
                processInputCharacters(kstr);
            }
        }
    }
    @Override public void processInputCharacters(String text) {
        if (verbosity > 0)
            System.err.println("processInputCharacters["+WTDebug.toQuoted(text)+"]");
        try {
            pin.write(text);
            pin.flush();
        } catch (Throwable ex) {
            ex.printStackTrace();
            System.exit(-1);
        }
    }

    @Override
    public void setWindowSize(int nrows, int ncols, int pixw, int pixh) {
        pty.setWindowSize(nrows, ncols, pixw, pixh);
    }
}
