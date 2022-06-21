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

#ifndef WEBVIEW_H
#define WEBVIEW_H

#include <QIcon>
#include <QWebEngineView>

QT_BEGIN_NAMESPACE
class QMouseEvent;
class QNetworkProxy;
class QNetworkReply;
class QSslError;
QT_END_NAMESPACE

class Backend;
class BrowserMainWindow;
class ProcessOptions;
#include "processoptions.h"
#if USE_KDDockWidgets
#include <kddockwidgets/KDDockWidgets.h>
#include <kddockwidgets/DockWidget.h>
typedef KDDockWidgets::DockWidget DockWidget;
#endif
#if USE_DOCK_MANAGER
#include "DockManager.h"
typedef ads::CDockWidget DockWidget;
#endif

class WebPage : public QWebEnginePage {
    Q_OBJECT
public:
    WebPage(QWebEngineProfile *profile, QObject *parent = 0);

protected:
#if !defined(QT_NO_UITOOLS)
    QObject *createPlugin(const QString &classId, const QUrl &url, const QStringList &paramNames, const QStringList &paramValues);
#endif
    virtual bool certificateError(const QWebEngineCertificateError &error) Q_DECL_OVERRIDE;

private slots:
#if defined(QWEBENGINEPAGE_UNSUPPORTEDCONTENT)
    void handleUnsupportedContent(QNetworkReply *reply);
#endif

private:
    friend class WebView;

    // set the webview mousepressedevent
    Qt::KeyboardModifiers m_keyboardModifiers;
    Qt::MouseButtons m_pressedButtons;
};

class WebView : public QWebEngineView {
    Q_OBJECT

public:
    WebView(QSharedDataPointer<ProcessOptions> processOptions,
            QWidget *parent = 0);
    QSharedDataPointer<ProcessOptions> m_processOptions;
    void newPage(const QString& url);
    WebPage *webPage() const { return m_page; }
    Backend *backend() const { return m_backend; }
    BrowserMainWindow *mainWindow();
    void setPage(WebPage *page);
    bool blockCaret() { return m_blockCaret; }
    void setBlockCaret(bool set) { m_blockCaret = set; }

    QAction *saveAsAction() const { return m_saveAsAction; }
    QAction *changeCaretAction() const { return m_changeCaretAction; }
    void showContextMenu(const QString& contextType); // FIXME
    void loadUrl(const QUrl &url);
    QUrl url() const;
#if USE_KDDockWidgets
    void setDockWidget(KDDockWidgets::DockWidget *dock);
#endif
#if USE_KDDockWidgets || USE_DOCK_MANAGER
    DockWidget *dockWidget();
    DockWidget *setDockWidget(const QString &uniqueName);
#endif
    inline int progress() const { return m_progress; }
public slots:
    QString generateSaveFileName();
    void requestSaveAs();
    void requestChangeCaret(bool);
    void setSetting(const QString& key, const QString& value);
signals:
    void finished();

protected:
    void mousePressEvent(QMouseEvent *event);
    void mouseReleaseEvent(QMouseEvent *event);
    void contextMenuEvent(QContextMenuEvent *event);
    void wheelEvent(QWheelEvent *event);
private:
    void displayContextMenu(const QString& contextType);

private slots:
    void setProgress(int progress);
    void loadFinished(bool success);
    void onIconChanged(const QIcon &icon);
    void slotOpenLink();
    void slotCopyLinkAddress();
    void slotCopyInContext();

private:
#if USE_KDDockWidgets || USE_DOCK_MANAGER
    DockWidget *m_dockWidget;
#endif
    QUrl m_initialUrl;
    int m_progress;
    WebPage *m_page;
    Backend *m_backend;
    bool m_blockCaret;
    QString contextTypeForMenu;
    QPoint contextMenuPosition;
    QAction *m_saveAsAction;
    QAction *m_changeCaretAction;
    QAction *m_openAction;
    QAction *m_copyLinkAddress;
    QAction *m_copyInContext;
};

#endif
