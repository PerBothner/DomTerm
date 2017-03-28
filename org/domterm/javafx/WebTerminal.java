/*
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

package org.domterm.javafx;

import org.domterm.*;
import org.domterm.util.*;
import javafx.scene.web.*;
import org.w3c.dom.*;
import org.w3c.dom.Node;
import javafx.scene.input.KeyEvent;
import javafx.scene.layout.*;
import org.w3c.dom.events.EventTarget;
import netscape.javascript.JSObject;
import javafx.application.Platform;
import javafx.scene.control.Control;
import javafx.scene.input.Clipboard;
import javafx.scene.input.ClipboardContent;
import javafx.scene.input.DataFormat;
import javafx.scene.input.KeyCode;
import javafx.beans.value.ChangeListener;
import javafx.beans.value.ObservableValue;
import javafx.concurrent.Worker.State;

/** Implements a "rich-term" console/terminal based on a WebView.
 *
 * A "line" is a sequence of text or inline elements - usually span elements.
 * A div or paragraph of N lines has (N-1) br elements between lines.
 * (br elements are only allowed in div or p elements.)
 */
public class WebTerminal extends VBox // FIXME should extend Control
    implements javafx.event.EventHandler,
                 org.w3c.dom.events.EventListener
                      /*implements KeyListener, ChangeListener*/ 
{
    public Backend backend;
    public void log(String str) { WTDebug.println(str); }
    
    WebView webView;
    protected WebView getWebView() { return webView; } 

    public WebEngine webEngine;
    JSObject jsWebTerminal;

    String defaultBackgroundColor = "white";
    String defaultForegroundColor = "black";

    public boolean isLineEditing() {
        Object val = jsWebTerminal.getMember("lineEditing");
        return val != null
            && val instanceof Boolean && ((Boolean) val).booleanValue();
    }
    public void setLineEditing(boolean lineEditing) {
        jsWebTerminal.setMember("lineEditing", lineEditing);
    }
    public void setLineEditing(char mode) {
        jsWebTerminal.setMember("autoEditing", mode == 'a');
        jsWebTerminal.setMember("lineEditing", mode == 'l');
    }
    public String getSelectedText() {
        return jsWebTerminal.call("getSelectedText").toString();
    }
    public void pasteText(String str) {
         jsWebTerminal.call("pasteText", str);
    }
    public void doCopy() {
        String selected = getSelectedText();
        ClipboardContent content = new ClipboardContent();
        content.putString(selected);
        Clipboard.getSystemClipboard().setContent(content);
    }
    public void doPaste () {
        String content = (String) Clipboard.getSystemClipboard()
            .getContent(DataFormat.PLAIN_TEXT);
        if (content != null) {
            pasteText(content);
        }
    }

    /** Input lines that have not been processed yet.
     * In some modes we support enhanced type-ahead: Input lines are queued
     * up and only released when requested.  This allows output from an
     * earlier command, as well as prompt text for a later command, to
     * be inserted before a later input-line.
     */
    //Node pendingInput;

    public void setWindowSize(int nrows, int ncols, int pixh, int pixw) {
        if (backend != null)
            backend.setWindowSize(nrows, ncols, pixh, pixw);
    }
    public void close() {
        WebTerminalApp app = WebTerminalApp.instance;
        if (app != null && app.mainClient == backend)
            app.stop();
    }

    protected void enter(KeyEvent ke) {
    }
    public void handle(javafx.event.Event ke) {
    }

    public void handleEvent(org.w3c.dom.events.Event event) {
        System.err.println("WT.handleEvent "+event);
    }

  /*
    public String getPendingInput() {
	String text = null;
	while (pendingInput != getInputLine() && text == null) {
	    if (isSpanNode(pendingInput)) {
		text = grabInput((Element) pendingInput);
		if (text.length() == 0)
		    text = null;
	    } else if (isBreakNode(pendingInput)) {
		text = "\n";
	    } else if (pendingInput instanceof Text) {
		text = ((Text) pendingInput).getData();
		if (text.length() == 0)
		    text = null;
	    } else {
		//WTDebug.println("UNEXPECTED NODE: "+WTDebug.pnode(pendingInput));
	    }
	    pendingInput = pendingInput.getNextSibling();
	}
	setOutputPosition(pendingInput);
	return text;
    }
    */

    Document documentNode;

    public Document getDocumentNode() { return documentNode; }

    protected void loadSucceeded() {
    }

    public void setBackend(Backend backend) {
        this.backend = backend;
    }

    public WebTerminal(final Backend backend) {
        setBackend(backend);
        webView = new WebView();
        webEngine = webView.getEngine();
        webEngine.getLoadWorker().stateProperty().addListener(new ChangeListener<State>() {
                public void changed(ObservableValue<? extends State> ov, State t, State newValue) {
                    if (newValue == State.SUCCEEDED) {
                        initialize();
                        if (initialOutput != null) {
                            if (backend != null && backend.verbosity > 0)
                                WTDebug.println("WT.changed newV:"+newValue+" initial:"+initialOutput+" jsW:"+jsWebTerminal+" outB:"+jsWebTerminal.getMember("outputBefore"));
                            jsWebTerminal.call("insertString", initialOutput);
                            initialOutput = null;
                        }
                        loadSucceeded();
                    }
                }});

        loadPage(webEngine);
        this.getChildren().add(webView);

        // We run the key-event handlers during the filter (capture) phase,
        // rather than the normal (bubbling) phase.  This allows us to
        // consume the event, so it never gets to the bubbling phase - and
        // thus never gets passed to the native component.  (In JavaScript
        // one can call preventDefault or have the handler return false,
        // but we don't have the functionality with JavaFX events.)
        //webView.addEventFilter(KeyEvent.KEY_PRESSED, this);
        //webView.addEventFilter(KeyEvent.KEY_TYPED, this);

        VBox.setVgrow(webView, Priority.ALWAYS);
    }

    public static final boolean USE_XHTML = false;
    public static final String XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
    public static final String htmlNamespace = USE_XHTML ? XHTML_NAMESPACE : "";

    /** URL for the initial page to be loaded.
     * @return the URL of the initial page resource as a String
     */
    protected String pageUrl() {
        String rname = "jfx-term.html";
        java.net.URL rurl = Backend.class.getClassLoader().getResource(rname);
        if (rurl == null)
            throw new RuntimeException("no initial web page "+rname);
        return rurl.toString();
    }

    /** Load the start page.  Do not call directly.
     * Can be overridden to load a start page from a String:
     * webEngibe.loadContent("initialContent", "MIME/type");
     * @param webEngine the WebEngin this WebView is using.
     */
    protected void loadPage(WebEngine webEngine) {
        webEngine.load(pageUrl());
    }

    protected void initialize() {
        try {
            documentNode = webEngine.getDocument();
            Object tmp = webEngine.executeScript("makeDomTerm()");
            jsWebTerminal = (JSObject) tmp;
            jsWebTerminal.setMember("java", this);
            jsWebTerminal.setMember("jclient", backend);
            webEngine.executeScript("initDomTerm()");
            backend.run(new WebWriter(this));
        } catch (Exception ex) {
            ex.printStackTrace();
            throw new RuntimeException(ex);
        }
    }

    public final void processInputCharacters(String text) {
        if (backend != null)
            backend.processInputCharacters(text);
    }

    private String initialOutput;

    public void insertOutput(final String str) {
       Platform.runLater(new Runnable() {
                public void run() {
                    //jsWebTerminal = (JSObject) webEngine.executeScript("webTerminal");
                    if (backend != null && backend.verbosity > 0)
                        WTDebug.println("insertOutput/later jsW:"+jsWebTerminal+" str:"+WTDebug.toQuoted(str));
                    if (jsWebTerminal == null)
                        initialOutput = initialOutput == null ? str
                            : initialOutput + str;
                    else
                        jsWebTerminal.call("insertString", str);
                }
            });


    }
}
