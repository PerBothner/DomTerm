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
#include <QRegExp>
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

/** Encode an arbitrary sequence of bytes as an ASCII string.
 * This is used because QWebChannel doesn't have a way to transmit
 * data except as strings or JSON-encoded strings.
 * We restrict the encoding to ASCII (i.e. codes less then 128)
 * to avoid excess bytes if the result is UTF-8-encoded.
 *
 * The encoding optimizes UTF-8 data, with the following byte values:
 * 0-3: 1st byte of a 2-byte sequence encoding an arbitrary 8-bit byte.
 * 4-7: 1st byte of a 2-byte sequence encoding a 2-byte UTF8 Latin-1 character.
 * 8-13: mean the same ASCII control character
 * 14: special case for ESC
 * 15: followed by 2 more bytes  encodes a 2-byte UTF8 sequence.
 * bytes 16-31: 1st byte of a 3-byte sequence encoding a 3-byte UTF8 sequence.
 * 32-127: mean the same ASCII printable character
 * The only times we generate extra bytes for a valid UTF8 sequence
 * if for code-points 0-7, 14-26, 28-31, 0x100-0x7ff.
 * A byte that is not part of a valid UTF9 sequence may need 2 bytes.
 * (A character whose encoding is partial, may also need extra bytes.)
 */
static QString encodeAsAscii(const char * buf, int len)
{
    QString str;
    const unsigned char *ptr = (const unsigned char *) buf;
    const unsigned char *end = ptr + len;
    while (ptr < end) {
        unsigned char ch = *ptr++;
        if (ch >= 32 || (ch >= 8 && ch <= 13)) {
            // Characters in the printable ascii range plus "standard C"
            // control characters are encoded as-is
            str.append(QChar(ch));
        } else if (ch == 27) {
            // Special case for ESC, encoded as '\016'
            str.append(QChar(14));
        } else if ((ch & 0xD0) == 0xC0 && end - ptr >= 1
                 && (ptr[0] & 0xC0) == 0x80) {
            // Optimization of 2-byte UTF-8 sequence
            if ((ch & 0x1C) == 0) {
                // If Latin-1 encode 110000aa,10bbbbbb as 1aa,0BBBBBBB
                // where BBBBBBB=48+bbbbbb
              str.append(4 + QChar(ch & 3));
            } else {
                // Else encode 110aaaaa,10bbbbbb as '\017',00AAAAA,0BBBBBBB
                // where AAAAAA=48+aaaaa;BBBBBBB=48+bbbbbb
                str.append(QChar(15));
                str.append(QChar(48 + (ch & 0x3F)));
            }
            str.append(QChar(48 + (*ptr++ & 0x3F)));
        } else if ((ch & 0xF0) == 0xE0 && end - ptr >= 2
                 && (ptr[0] & 0xC0) == 0x80 && (ptr[1] & 0xC0) == 0x80) {
            // Optimization of 3-byte UTF-8 sequence
            // encode 1110aaaa,10bbbbbb,10cccccc as AAAA,0BBBBBBB,0CCCCCCC
            // where AAAA=16+aaaa;BBBBBBB=48+bbbbbb;CCCCCCC=48+cccccc
            str.append(QChar(16 + (ch & 0xF)));
            str.append(QChar(48 + (*ptr++ & 0x3F)));
            str.append(QChar(48 + (*ptr++ & 0x3F)));
        } else {
            // The fall-back case - use 2 bytes for 1:
            // encode aabbbbbb as 000000aa,0BBBBBBB, where BBBBBBB=48+bbbbbb
            str.append(QChar((ch >> 6) & 3));
            str.append(QChar(48 + (ch & 0x3F)));
        }
    }
    return str;
}

void Backend::onReceiveBlock( const char * buf, int len )
{
    emit writeEncoded(len, encodeAsAscii(buf, len));
}

void Backend::paste()
{
    QString text = QApplication::clipboard()->text();
    // There is some problem accessing the clipboard it has been
    // set by another process.
    // (Weirdly C-S-V works, but Edit->Paste doesn't.)
    // This defers to libclipboard when direct access doesn't work.
    if (text.isEmpty())
        emit reportEventToServer("REQUEST-CLIPBOARD-TEXT", "");
    else
        emit pasteText(text);
}

void Backend::setInputMode(char mode)
{
    emit writeInputMode((int) mode);
}

void Backend::setSessionName(const QString& name)
{
   _nameTitle = name;
}

void Backend::requestHtmlData()
{
    emit writeOperatingSystemControl(102, "");
}

void Backend::requestChangeCaret(bool set)
{
    emit writeSetCaretStyle(set ? 1 : 5);
}

void Backend::loadSessionName()
{
    emit writeOperatingSystemControl(30, _nameTitle);
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
    auto webv = new WebView(webView()->m_processOptions,   webView());
    webv->newPage(url);
    webv->resize(300, 300);
    webv->show();
//   webv->lower();
    webView()->mainWindow()->application()->registerPane(windowNumber, webv);
    webv->backend()->_windowNumber = windowNumber;
    webv->setFocus(Qt::OtherFocusReason); // FIXME
}
#endif
void Backend::adoptPane(int windowNumber)
{
    mainWindow()->application()->adoptPane(windowNumber, webView());
}
void Backend::setGeometry(int windowNumber, int x, int y, int width, int height)
{
    mainWindow()->application()->setGeometry(windowNumber, x, y, width, height);
}
void Backend::closePane(int windowNumber)
{
    mainWindow()->application()->closePane(windowNumber);
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
    QString xurl = url + (url.indexOf('#') < 0 ? "#" : "&") + "qtwebengine";
    // if default changes to "domterm": titlebar=="system"
    bool use_titlebar = titlebar=="" || titlebar=="system";
    BrowserApplication::instance()->newMainWindow(xurl, width, height,
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
