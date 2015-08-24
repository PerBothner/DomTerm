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

package webterminal;

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
import javafx.scene.input.KeyCode;
import javafx.beans.value.ChangeListener;
import javafx.beans.value.ObservableValue;
import javafx.concurrent.Worker.State;
import java.util.List;
import java.util.ArrayList;

/** Implements a "rich-term" console/terminal based on a WebView.
 *
 * A "line" is a sequence of text or inline elements - usually span elements.
 * A div or paragraph of N lines has (N-1) br elements between lines.
 * (br elements are only allowed in div or p elements.)
 */
public class WebTerminal extends VBox // FIXME should extend Control
      implements javafx.event.EventHandler, org.w3c.dom.events.EventListener
                      /*implements KeyListener, ChangeListener*/ 
{
    public void log(String str) { System.err.println(str); }
    
    WebView webView;
    protected WebView getWebView() { return webView; } 

    protected WebEngine webEngine;
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

    public boolean outputLFasCRLF() { return isLineEditing(); }

    /** Input lines that have not been processed yet.
     * In some modes we support enhanced type-ahead: Input lines are queued
     * up and only released when requested.  This allows output from an
     * earlier command, as well as prompt text for a later command, to
     * be inserted before a later input-line.
     */
    Node pendingInput;

    /** The current input line.
     * Note there is always a current (active) input line, even if the
     * inferior isn't ready for it, and hasn't emitted a prompt.
     * This is to support type-ahead, as well as application code
     * reading from standard input.
     * @return the currently active input line
     */
    public Element getInputLine() { return inputLine; }
    public void setInputLine(Element inputLine) { this.inputLine = inputLine; }
    Element inputLine;

    public void setWindowSize(int nrows, int ncols, int pixw, int pixh) {
    }

    protected void enter(KeyEvent ke) {
    }

    public void handleEvent(org.w3c.dom.events.Event event) {
    }

    public void handle(javafx.event.Event ke) {
        /*
        if (ke instanceof javafx.event.ActionEvent)
            handle((javafx.event.ActionEvent) ke);
        if (ke instanceof javafx.scene.input.KeyEvent)
            handle((javafx.scene.input.KeyEvent) ke);
        */
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
    Element bodyNode;

    public Document getDocumentNode() { return documentNode; }

    protected void loadSucceeded() {
        //addInputLine();
    }

    public WebTerminal() {
        webView = new WebView();
        webEngine = webView.getEngine();
        webEngine.getLoadWorker().stateProperty().addListener(new ChangeListener<State>() {
                public void changed(ObservableValue<? extends State> ov, State t, State newValue) {
                    if (newValue == State.SUCCEEDED) {
                        initialize();
                        if (initialOutput != null) {
                            System.err.println("WT.changed newV:"+newValue+" initial:"+initialOutput+" jsW:"+jsWebTerminal+" outB:"+jsWebTerminal.getMember("outputBefore"));
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
        String rname = USE_XHTML ? "repl.xml" : "repl.html";
        java.net.URL rurl = WebTerminal.class.getResource(rname);
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
        documentNode = webEngine.getDocument();
        bodyNode = documentNode.getElementById("body");
        Object tmp = webEngine.executeScript("makeDomTerm()");
        jsWebTerminal = (JSObject) tmp;
        jsWebTerminal.setMember("java", this);

        //((EventTarget) bodyNode).addEventListener("click", this, false);

        //if (isLineEditing())             ((JSObject) bodyNode).call("focus");
        // Element initial = documentNode.getElementById("initial"); FIXME LEAKS
        //Element initial = (Element) bodyNode.getFirstChild();
        //cursorHome = initial;
        //outputContainer = initial;
    }

    protected void setEditable(Element element, boolean editable) {
        ((JSObject) element).setMember("contentEditable", editable);
    }
    
    protected void setEditable(boolean editable) {
        setEditable(getInputLine(), editable);
    }
    
    public void processInputCharacters(String text) {
    }

    private String initialOutput;

    // FIXME kind is ignored, for now
    public void insertOutput(final String str, final char kind) {
       Platform.runLater(new Runnable() {
                public void run() {
                    //jsWebTerminal = (JSObject) webEngine.executeScript("webTerminal");
                    System.err.println("insertOutput/later jsW:"+jsWebTerminal+" str:"+str);
                    if (jsWebTerminal == null)
                        initialOutput = initialOutput == null ? str
                            : initialOutput + str;
                    else
                        jsWebTerminal.call("insertString", str);
                }
            });


    }
}
