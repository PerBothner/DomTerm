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

import org.domterm.Backend;
import javafx.application.Application;
import javafx.application.Platform;
import javafx.beans.value.ChangeListener;
import javafx.beans.value.ObservableValue;
import javafx.event.ActionEvent;
import javafx.event.EventHandler;
import javafx.scene.Node;
import javafx.scene.Scene;
import javafx.scene.layout.*;
import javafx.scene.control.ContextMenu;
import javafx.scene.control.Menu;
import javafx.scene.control.MenuItem;
import javafx.scene.control.RadioMenuItem;
import javafx.scene.control.Toggle;
import javafx.scene.control.ToggleGroup;
import javafx.scene.input.Clipboard;
import javafx.scene.input.ClipboardContent;
import javafx.scene.input.DataFormat;
import javafx.scene.input.KeyEvent;
import javafx.scene.input.MouseButton;
import javafx.scene.input.MouseEvent;
import javafx.scene.web.*;
import javafx.stage.Stage;
import java.io.*;

/** A simple application that just contains a WebConsole.
 * FIXME - needs a menubar with Edit menu and other settings.
 */

public class WebTerminalApp extends Application
{
    WebTerminal console;
    public static boolean exitOnStop;

    Scene createScene() throws java.lang.Exception {
        console = new WebTerminal(makeClient());
        //VBox.setVgrow(console.webView, Priority.ALWAYS);

        //FIXME web.addChangeListener(WebEngine.DOCUMENT, this);

        VBox pane = console;
        Scene scene = new Scene(pane);

        ContextMenu popup = new ContextMenu();
        pane.addEventHandler(MouseEvent.MOUSE_CLICKED,
                             new EventHandler<MouseEvent>() {
                                 @Override public void handle(MouseEvent e) {
                                     if (e.getButton() == MouseButton.SECONDARY)   {
                                         popup.show(pane, e.getScreenX(), e.getScreenY());
                                     }
                                 }
                             });
        pane.addEventHandler(MouseEvent.MOUSE_PRESSED,
                             new EventHandler<MouseEvent>() {
                                 @Override public void handle(MouseEvent e) {
                                     if (e.getButton() == MouseButton.SECONDARY)   {
                                         // Neeed to avoid selection being cancelled
                                         e.consume();
                                     }
                                 }
                             });

        MenuItem copyItem = new MenuItem("Copy");
        popup.getItems().add(copyItem);
        copyItem.setOnAction(new EventHandler<ActionEvent>() {
                public void handle(ActionEvent t) {
                    String selected = console.getSelectedText();
                    System.err.println("selected: ["+selected+"] event:"+t);
                    ClipboardContent content = new ClipboardContent();
                    content.putString(selected);
                    Clipboard.getSystemClipboard().setContent(content);
                    //console.webEngine.executeScript("document.execCommand('copy')");
                }
            });

        MenuItem pasteItem = new MenuItem("Paste");
        popup.getItems().add(pasteItem);
        pasteItem.setOnAction(new EventHandler<ActionEvent>() {
                public void handle(ActionEvent t) {
                    String content = (String) Clipboard.getSystemClipboard().getContent(DataFormat.PLAIN_TEXT);
                    System.err.println("pasted: ["+content+"] event:"+t);
                    if (content != null) {
                        console.pasteText(content);
                    }
                }
            });


        if (console.backend.lineEditingMode != 'p') {
            Menu inputModeMenu = new Menu("input mode");
            ToggleGroup inputModeGroup = new ToggleGroup();
            RadioMenuItem charModeItem = new RadioMenuItem("character mode");
            charModeItem.setToggleGroup(inputModeGroup);
            RadioMenuItem lineModeItem = new RadioMenuItem("line mode");
            lineModeItem.setToggleGroup(inputModeGroup);
            RadioMenuItem autoModeItem = new RadioMenuItem("auto mode");
            autoModeItem.setToggleGroup(inputModeGroup);
            inputModeMenu.getItems().add(charModeItem);
            inputModeMenu.getItems().add(lineModeItem);
            inputModeMenu.getItems().add(autoModeItem);
            autoModeItem.setSelected(true);
            popup.getItems().add(inputModeMenu);
            inputModeGroup.selectedToggleProperty().addListener(new ChangeListener<Toggle>() {
                    public void changed(ObservableValue<? extends Toggle> ov,
                                        Toggle old_toggle, Toggle new_toggle) {
                        if (new_toggle != null) {
                            String text = ((RadioMenuItem)new_toggle).getText();
                            console.setLineEditing(text.charAt(0));
                            System.err.println("TOGGLE "+inputModeGroup+" new:"+new_toggle+" - "+text);
                        }
                    }
                });
        }
        return scene;
    }

    static Backend mainClient;
    public static void setDefaultBackend(Backend backend) {
        mainClient = backend;
    }
    protected Backend makeClient() throws java.lang.Exception {
        if (mainClient == null)
            throw new RuntimeException("internal error - mainClient not set");
        return mainClient;
    }

    @Override public void start(Stage stage) throws java.lang.Exception {
        try {
        final Scene scene = createScene();
        stage.setTitle("DomTerm");

        stage.setScene(scene);
        //stage.sizeToScene();
        stage.setWidth(700);
        stage.setHeight(500);
        stage.show();
        } catch (Throwable ex) {
            ex.printStackTrace();
            throw new RuntimeException(ex);
        }
    }
    @Override public void stop() {
        System.err.println("Application stop called");
        if (exitOnStop)
            System.exit(0);
    }
}
