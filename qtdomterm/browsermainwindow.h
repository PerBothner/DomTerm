/****************************************************************************
**
** Copyright (C) 2016 The Qt Company Ltd.
** Contact: https://www.qt.io/licensing/
**
** This file is part of the demonstration applications of the Qt Toolkit.
**
** $QT_BEGIN_LICENSE:BSD$
** Commercial License Usage
** Licensees holding valid commercial Qt licenses may use this file in
** accordance with the commercial license agreement provided with the
** Software or, alternatively, in accordance with the terms contained in
** a written agreement between you and The Qt Company. For licensing terms
** and conditions see https://www.qt.io/terms-conditions. For further
** information use the contact form at https://www.qt.io/contact-us.
**
** BSD License Usage
** Alternatively, you may use this file under the terms of the BSD license
** as follows:
**
** "Redistribution and use in source and binary forms, with or without
** modification, are permitted provided that the following conditions are
** met:
**   * Redistributions of source code must retain the above copyright
**     notice, this list of conditions and the following disclaimer.
**   * Redistributions in binary form must reproduce the above copyright
**     notice, this list of conditions and the following disclaimer in
**     the documentation and/or other materials provided with the
**     distribution.
**   * Neither the name of The Qt Company Ltd nor the names of its
**     contributors may be used to endorse or promote products derived
**     from this software without specific prior written permission.
**
**
** THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
** "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
** LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
** A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
** OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
** SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
** LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
** DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
** THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
** (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
** OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."
**
** $QT_END_LICENSE$
**
****************************************************************************/

#ifndef BROWSERMAINWINDOW_H
#define BROWSERMAINWINDOW_H

#include <QtWidgets/QMainWindow>
#include <QtGui/QIcon>
#include <QtCore/QUrl>
#include <QRegularExpression>
#include <QAction>

QT_BEGIN_NAMESPACE
class QActionGroup;
class QWebEngineFrame;
QT_END_NAMESPACE

class WebView;
class ProcessOptions;
class BrowserApplication;
#if USE_KDDockWidgets
#include <kddockwidgets/DockWidget.h>
#include <kddockwidgets/MainWindow.h>
#endif
#if USE_DOCK_MANAGER && !ADS_MULTI_MAIN_WINDOW
#include "DockManager.h"
#endif

/*!
    The MainWindow of the Browser Application.

    Handles the tab widget and all the actions
 */
class BrowserMainWindow
#if USE_KDDockWidgets
    : public KDDockWidgets::MainWindow
#else
    : public QMainWindow
#endif
{
    Q_OBJECT
public:
    BrowserMainWindow(BrowserApplication*application, const QString& url, QSharedDataPointer<ProcessOptions> processOptions, int windowNumber, QWidget *parent, Qt::WindowFlags flags);
    ~BrowserMainWindow();
    static BrowserMainWindow* containingMainWindow(QWidget *);
    QSize sizeHint() const;
    void setSize(int width, int height) { m_width = width; m_height = height; }

public:
    WebView *webView() const;
    BrowserApplication* application() { return m_application; }
    void showMenubar(); // toggle
    void showMenubar(bool show);
#if USE_DOCK_MANAGER && !ADS_MULTI_MAIN_WINDOW
    ads::CDockManager* dockManager() { return m_DockManager; }
#endif
public slots:
    void loadPage(const QString &url);
    bool usingQtMenus() { return _usingQtMenus; }
    qreal mainZoom() { return _mainZoom; }

protected:
    void changeEvent(QEvent *event);
    void closeEvent(QCloseEvent *event);

private slots:
    void slotUpdateWindowTitle(const QString &title = QString());

    void slotSimpleCommand(const QString &command);

    void loadUrl(const QUrl &url);

    void slotViewFullScreen(bool enable);

    void slotToggleInspector(bool enable);

    void slotOpenActionUrl(QAction *action);
    void slotShowWindow();

#if defined(QWEBENGINEPAGE_PRINT)
    void printRequested(QWebEngineFrame *frame);
#endif
    void geometryChangeRequested(const QRect &geometry);
    void updateMenubarActionText(bool visible);

private:
    void loadDefaultState();

private:
    BrowserApplication *m_application;
    WebView *m_webView;
    int m_width, m_height;

    QAction *viewMenubarAction;
    QIcon m_reloadIcon;

    friend class BrowserApplication;
    friend class WebView;
    friend class NamedAction;

    bool _usingQtMenus;
#if USE_DOCK_MANAGER && !ADS_MULTI_MAIN_WINDOW
    ads::CDockManager* m_DockManager;
#endif
    qreal _mainZoom = 1.0;

    // The following fields ar used for context-menu handling
    QMenu *_context_menu = nullptr;
    std::chrono::steady_clock::time_point _context_menu_time;
    // 1: seen showContextMenu but not contextMenuEvent
    // 2: seen contextMenuEvent but not showContextMenu
    // 0: otherwise
    unsigned _context_menu_pending = 0;
    QString contextMenuAsJson;
    QPoint contextMenuPosition;
};

// NOTE Qt 6.3 has new addAction method that take Args
// which might rename the need for this class.
class NamedAction : public QAction {
    Q_OBJECT
public:
    NamedAction(const QString &text, BrowserApplication *w, const char *cmd);
    NamedAction(const QString &text, BrowserApplication *w, const char *cmd,
                const QKeySequence &);
    NamedAction(const QString &text, BrowserApplication *w, QObject *parent, const char *cmd);
    NamedAction(const QString &text, BrowserApplication *w, QObject *parent, const char *cmd,
                const QKeySequence &); // FIXME maybe unneeded
    BrowserApplication *application;
    const QString command;
    void doit();
};

#endif // BROWSERMAINWINDOW_H
