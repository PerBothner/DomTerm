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

package org.domterm.pty;

import org.domterm.Backend;
import org.domterm.util.Util;
import org.domterm.util.WTDebug;
import java.io.*;

/** Runs a process inside a PTY.
 * Requires OS-specific support for PTYs.
 * (Only natively available on Unix-like systems.)
 */

public class PtyBackend extends Backend {
    public Writer pin;
    public Reader pout;
    public PTY pty;
    String[] childArgs;

    static String[] defaultArgs = { "/bin/bash" };

    public PtyBackend() {
        this(null);
    }

    public PtyBackend(String[] childArgs) {
        if (childArgs == null || childArgs.length == 0)
            childArgs = defaultArgs;
        this.childArgs = childArgs;
    }

    @Override
    public void run(Writer out) throws Exception {
        addVersionInfo("PtyClient");
        pty = new PTY(childArgs, "xterm-256color",
                      new Object[] { "DOMTERM="+getVersionInfo() });
        try {
            pin = new OutputStreamWriter(pty.toChildInput);
            pout = new InputStreamReader(pty.fromChildOutput, "UTF-8");
        }
        catch (Throwable ex) {
            ex.printStackTrace();
            System.exit(-1);
        }
        this.termWriter = out;
        sendInputMode(lineEditingMode);
        Util.copyThread(pout, false, out);
    }

    @Override public boolean isCanonicalMode() {
        int mode = pty.getTtyMode();
        return (mode & 0000002) != 0;
    }

    @Override public boolean isEchoingMode() {
        int mode = pty.getTtyMode();
        return (mode & 0000010) != 0;
    }

    @Override public void processInputCharacters(String text) {
        if (verbosity > 0)
            WTDebug.println("processInputCharacters["+WTDebug.toQuoted(text)+"]");
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
        // We might get a call to setWindowSize before the PTY is
        // allocated in the run method.  We get another call after PTY
        // is allocated, so it appears ok to ignore it when pty is null.
        if (pty != null)
            pty.setWindowSize(nrows, ncols, pixw, pixh);
    }
}
