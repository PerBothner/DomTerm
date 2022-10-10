/*
    This file is part of QtDomTerm.
    It is derived from Session.cpp, which is part of Konsole.

    Copyright (C) 2016 by Per Bothner <per@bothner.com>

    Copyright (C) 2006-2007 by Robert Knight <robertknight@gmail.com>
    Copyright (C) 1997,1998 by Lars Doelle <lars.doelle@on-line.de>

    Rewritten for QT4 by e_k <e_k at users.sourceforge.net>, Copyright (C)2008

    This program is free software; you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 2 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program; if not, write to the Free Software
    Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA
    02110-1301  USA.
*/

#include <termios.h>

#include <QDir>
#include <QUrl>
#include <QtDebug>
#include <QTimer>
#include <QFileDialog>
#include <QMimeData>
#include <QWindow>
#include <QtGui/QClipboard>

#include "backend.h"
#include "browsermainwindow.h"
#include "browserapplication.h"
#include "savepagedialog.h"
#include "webview.h"

extern QVector<QWidget*> paneMap;

Backend::Backend(QSharedDataPointer<ProcessOptions> processOptions,
                 QObject *parent)
  :  QObject(parent),
     _processOptions(processOptions),
     _wantedClose(false)
{
    addDomtermVersion("QtDomTerm");
}

Backend::~Backend()
{
}

BrowserMainWindow *
Backend::mainWindow() const
{
    return webView()->mainWindow();
}

void Backend::setInputMode(char mode)
{
    emit writeInputMode((int) mode);
}

void Backend::requestChangeCaret(bool set)
{
    emit writeSetCaretStyle(set ? 1 : 5);
}

void Backend::close()
{
    _wantedClose = true;
}

void Backend::saveFile(const QString& html)
{
    QString filePath = webView()->generateSaveFileName();
#if 0
    // FIXME The default is used only on the first call.  Bug in Qt?
    filePath = QFileDialog::getSaveFileName(webView(), tr("Save this Page As"),
                                            filePath);
    if (filePath.isEmpty()) {
        return;
    }
#else
    SavePageDialog dlg(webView(), /*format,*/ filePath);
    if (dlg.exec() != SavePageDialog::Accepted)
        return;
    filePath = dlg.filePath();
#endif
    QFile file(filePath);
    if (file.open(QIODevice::WriteOnly | QIODevice::Text)) {
      file.write(html.toUtf8());
      file.close();
    } else {
      // REPORT ERROR FIXME!
    }
}

void Backend::setWindowTitle(const QString& title)
{
    webView()->mainWindow()->setWindowTitle(title);
}

void Backend::windowOp(const QString& opname)
{
    if (opname == "close")
        webView()->mainWindow()->close();
    else if (opname == "show")
        webView()->mainWindow()->showNormal();
    else if (opname == "hide")
        webView()->mainWindow()->hide();
    else if (opname == "minimize")
         webView()->mainWindow()->showMinimized();
}

#if USE_KDDockWidgets || USE_DOCK_MANAGER
void Backend::newPane(int paneOp, const QString& url)
{
    auto webv = new WebView(webView()->m_processOptions, nullptr);
    webv->newPage(url);
    auto dockw = webv->setDockWidget(BrowserApplication::uniqueNameFromUrl(url));
    auto curDock = webView()->dockWidget();
#if USE_DOCK_MANAGER
#if ADS_MULTI_MAIN_WINDOW
    auto manager = BrowserApplication::instance()->dockManager();
#else
    auto manager = webView()->mainWindow()->dockManager();
#endif
    ads::DockWidgetArea location = ads::NoDockWidgetArea;
    switch (paneOp) {
    case 2:
        manager->addDockWidgetTabToArea(dockw, curDock->dockAreaWidget());
        return;
    case 10: location = ads::LeftDockWidgetArea; break;
    case 11: location = ads::RightDockWidgetArea; break;
    case 12: location = ads::TopDockWidgetArea; break;
    case 13: location = ads::BottomDockWidgetArea; break;
    }
    manager->addDockWidget(location, dockw, curDock->dockAreaWidget());
#endif
#if USE_KDDockWidgets
    KDDockWidgets::Location location = KDDockWidgets::Location_OnRight;
    switch (paneOp) {
    case 2:
        curDock->addDockWidgetAsTab(dockw);
        return;
    case 10: location = KDDockWidgets::Location_OnLeft; break;
    case 11: location = KDDockWidgets::Location_OnRight; break;
    case 12: location = KDDockWidgets::Location_OnTop; break;
    case 13: location = KDDockWidgets::Location_OnBottom; break;
    }
    curDock->addDockWidgetToContainingWindow(dockw, location, curDock);
#endif
}
#else
void Backend::newPane(int windowNumber, const QString& url)
{
    auto webv = new WebView(webView()->m_processOptions, webView());
    webv->newPage(url);
    webv->resize(300, 300);
    webv->show();
//   webv->lower();
    mainWindow()->application()->registerPane(windowNumber, webv);
    webv->backend()->_windowNumber = windowNumber;
    webv->setFocus(Qt::OtherFocusReason); // FIXME
}
#endif
void Backend::adoptPane(int windowNumber)
{
    auto pane = paneFor(windowNumber);
    if (pane)
        pane->setParent((QWidget*) webView());
}

void Backend::setPaneZoom(int windowNumber, qreal zoom)
{
    auto pane = paneFor(windowNumber);
    if (pane) {
        WebView *webv = dynamic_cast<WebView*>(pane);
        if (webv)
            webv->setPaneZoom(zoom);
    }
}

void Backend::setMainZoom(qreal zoom)
{
    auto mainW = mainWindow();
    mainW->application()->setMainZoom(zoom, mainW);
}

void Backend::setGeometry(int windowNumber, int x, int y, int width, int height)
{
    auto pane = paneFor(windowNumber);
    if (pane) {
         qreal zoom = mainWindow()->mainZoom();
         if (zoom > 0 && zoom != 1.0) {
             width = (int) (zoom * width + 0.5);
             height = (int) (zoom * height + 0.5);
             x = (int) (zoom * x + 0.5);
             y = (int) (zoom * y + 0.5);
         }
         pane->setGeometry(x, y, width, height);
    }
}
void Backend::closePane(int windowNumber)
{
    mainWindow()->application()->closePane(windowNumber);
}
void Backend::focusPane(int windowNumber)
{
    if (windowNumber < 0)
        mainWindow()->webView()->setFocus();
    else
        mainWindow()->application()->focusPane(windowNumber);
}

QWidget* Backend::paneFor(int windowNumber)
{
    return windowNumber >= paneMap.size() || windowNumber < 0 ? nullptr
        : paneMap[windowNumber];
}

void Backend::showPane(int windowNumber, bool visible)
{
    mainWindow()->application()->showPane(windowNumber, visible);
}
void Backend::lowerOrRaisePanes(bool raise, bool allWindows)
{
    auto mainWin = mainWindow();
    mainWin->application()->lowerOrRaisePanes(raise, allWindows, mainWin);
}

void Backend::sendChildMessage(int windowNumber, const QString& command, const QString& args_json)
{
    webView()->mainWindow()->application()->sendChildMessage(windowNumber, command, args_json);
}
void Backend::sendParentMessage(const QString& command, const QString& args_json)
{
    emit webView()->mainWindow()->webView()->backend()->forwardToParentWindow(windowNumber(), command, args_json);
}

void Backend::openNewWindow(int width, int height, const QString& position,
                            const QString& url, bool headless,
                            const QString& titlebar)
{
#if USE_DOCK_MANAGER && !ADS_MULTI_MAIN_WINDOW
    auto manager = webView()->mainWindow()->dockManager();
    auto webv = new WebView(webView()->m_processOptions, nullptr);
    webv->newPage(url);
    auto dockw = webv->setDockWidget(BrowserApplication::uniqueNameFromUrl(url));
    manager->addDockWidgetFloating(dockw);
#else
    QSharedDataPointer<ProcessOptions> options = webView()->m_processOptions;
    bool use_titlebar = titlebar=="system";
    BrowserApplication::instance()->newMainWindow(url, width, height,
                                                  position, headless,
                                                  use_titlebar, options);
#endif
}

void Backend::showContextMenu(const QString& contextType)
{
    webView()->showContextMenu(contextType);
}

void Backend::setSetting(const QString& key, const QString& value)
{
    webView()->setSetting(key, value);
}

void Backend::setClipboard(const QString& textPlain, const QString& textHtml)
{
    QClipboard *clipboard = QGuiApplication::clipboard();
    QMimeData *data = new QMimeData();
    if (textPlain.size() > 0)
        data->setText(textPlain);
    if (textHtml.size() > 0)
        data->setHtml(textHtml);
    clipboard->setMimeData(data);
}

void Backend::inputModeChanged(int mode)
{
    webView()->mainWindow()->inputModeChanged((char) mode);
}

void Backend::autoPagerChanged(bool mode)
{
    webView()->mainWindow()->autoPagerChanged(mode);
}

void Backend::log(const QString& message)
{
    if (false) {
        //message = toJsonQuoted(message);
        fprintf(stderr, "log called %s\n", message.toUtf8().constData());
        fflush(stderr);
    }
}

void Backend::startSystemMove()
{
    webView()->mainWindow()->windowHandle()->startSystemMove();
}

void Backend::startSystemResize(const QString &edges)
{
    Qt::Edges e;
    if (edges.contains('s'))
        e |= Qt::BottomEdge;
    if (edges.contains('n'))
        e |= Qt::TopEdge;
    if (edges.contains('w'))
        e |= Qt::LeftEdge;
    if (edges.contains('e'))
        e |= Qt::RightEdge;
    webView()->mainWindow()->windowHandle()->startSystemResize(e);
}

void Backend::addDomtermVersion(const QString &info)
{
    if (_domtermVersion.isEmpty())
        _domtermVersion = info;
    else {
        _domtermVersion += ';';
        _domtermVersion += info;
    }
}

QString Backend::toJsonQuoted(QString str)
{
    QString buf;
    int len = str.length();
    buf += '\"';
    for (int i = 0;  i < len;  i++) {
        QChar qch = str[i];
        int ch = qch.unicode();
        if (ch == '\n')
           buf += "\\n";
        else if (ch == '\r')
            buf += "\\r";
        else if (ch == '\t')
            buf += "\\t";
        else if (ch == '\b')
            buf += "\\b";
        else if (ch < ' ' || ch >= 127) {
            buf += "\\u";
            QString hex = QString::number(ch, 16);
            int slen = hex.length();
            if (slen == 1) buf += "000";
            else if (slen == 2) buf += "00";
            else if (slen == 3) buf += "0";
            buf += hex;
        } else {
            if (ch == '\"' || ch == '\\')
                buf += '\\';
            buf += qch;
        }
    }
    buf += '\"';
    return buf;
}

ProcessOptions* Backend::processOptions()
{
    return _processOptions.data();
}
