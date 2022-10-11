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

#include "browserapplication.h"

#include "browsermainwindow.h"
#include "webview.h"

#include <getopt.h>

#include <QUrl>
#include <QUrlQuery>
#include <QtCore/QBuffer>
#include <QtCore/QDir>
#include <QtCore/QLibraryInfo>
#include <QtCore/QSettings>
#include <QtCore/QTextStream>
#include <QtCore/QTimer>
#include <QWindow>
#include <QScreen>
#include <QSize>
#include <QVector>
#include <QNetworkAccessManager>
#include <QStandardPaths>
#include <QRegularExpression>

#include <QtGui/QDesktopServices>
#include <QtGui/QFileOpenEvent>
#include <QtWidgets/QMessageBox>

#include <QtNetwork/QLocalServer>
#include <QtNetwork/QLocalSocket>
#include <QtNetwork/QNetworkProxy>
#include <QtNetwork/QSslSocket>

#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QtCore/QDebug>
#if USE_KDDockWidgets
#include <kddockwidgets/Config.h>
#endif
#include <backend.h>
QNetworkAccessManager *BrowserApplication::s_networkAccessManager = 0;
QVector<QWidget*> paneMap;

BrowserApplication::BrowserApplication(int &argc, char **argv,QSharedDataPointer<ProcessOptions> processOptions)
    : QApplication(argc, argv)
    , m_privateProfile(0)
    , nextSessionNameIndex(1)
    , saveFileCounter(0)
    , headlessOption(processOptions->headless)
{
    nameTemplate = QLatin1String("domterm-%1");
    QCoreApplication::setOrganizationName(QLatin1String("DomTerm"));
    QCoreApplication::setApplicationName(QLatin1String("QtDomTerm"));
    QCoreApplication::setApplicationVersion(QLatin1String(QTDOMTERM_VERSION));
    QString serverName = QCoreApplication::applicationName()
        + QString::fromLatin1(QT_VERSION_STR).remove('.') + QLatin1String("webengine");

    QLocalSocket socket;
    socket.connectToServer(serverName);
    if (socket.waitForConnected(500)) {
        QDataStream stream(&socket);
        stream << *processOptions;
        socket.waitForBytesWritten();
        return;
    }

#if defined(Q_OS_OSX)
    QApplication::setQuitOnLastWindowClosed(false);
#else
    QApplication::setQuitOnLastWindowClosed(true);
#endif

#ifndef QT_NO_OPENSSL
    if (!QSslSocket::supportsSsl()) {
    QMessageBox::information(0, "Demo Browser",
                 "This system does not support OpenSSL. SSL websites will not be available.");
    }
#endif

    QTimer::singleShot(0, this, SLOT(postLaunch()));

#if USE_KDDockWidgets
    auto flags = KDDockWidgets::Config::self().flags();
    flags |= KDDockWidgets::Config::Flag_HideTitleBarWhenTabsVisible;
    flags |= KDDockWidgets::Config::Flag_AllowReorderTabs;
    flags |= KDDockWidgets::Config::Flag_NativeTitleBar;
    //flags |= KDDockWidgets::Config::Flag_AlwaysTitleBarWhenFloating;
    KDDockWidgets::Config::self().setFlags(flags);
#endif
#if USE_DOCK_MANAGER && ADS_MULTI_MAIN_WINDOW
    m_DockManager = new ads::CDockManager();
#endif
}

BrowserApplication::~BrowserApplication()
{
    for (int i = 0; i < m_mainWindows.size(); ++i) {
        BrowserMainWindow *window = m_mainWindows.at(i);
        delete window;
    }
    delete s_networkAccessManager;
}

BrowserApplication *BrowserApplication::instance()
{
    return (static_cast<BrowserApplication *>(QCoreApplication::instance()));
}

void BrowserApplication::quitBrowser()
{
}

/*!
    Any actions that can be delayed until the window is visible
 */
void BrowserApplication::postLaunch()
{
    QString directory = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    if (directory.isEmpty())
        directory = QDir::homePath() + QLatin1String("/.") + QCoreApplication::applicationName();
#if defined(QWEBENGINESETTINGS_PATHS)
    QWebEngineSettings::setIconDatabasePath(directory);
    QWebEngineSettings::setOfflineStoragePath(directory);
#endif

    loadSettings();
}

void BrowserApplication::loadSettings()
{
#if 0
    // Doesn't work on Qt6. Probably not useful anyway.
    QSettings settings;
    settings.beginGroup(QLatin1String("websettings"));

    QWebEngineSettings *defaultSettings = QWebEngineSettings::globalSettings();
    QWebEngineProfile *defaultProfile = QWebEngineProfile::defaultProfile();

    QString standardFontFamily = defaultSettings->fontFamily(QWebEngineSettings::StandardFont);
    int standardFontSize = defaultSettings->fontSize(QWebEngineSettings::DefaultFontSize);
    QFont standardFont = QFont(standardFontFamily, standardFontSize);
    standardFont = qvariant_cast<QFont>(settings.value(QLatin1String("standardFont"), standardFont));
    defaultSettings->setFontFamily(QWebEngineSettings::StandardFont, standardFont.family());
    defaultSettings->setFontSize(QWebEngineSettings::DefaultFontSize, standardFont.pointSize());

    QString fixedFontFamily = defaultSettings->fontFamily(QWebEngineSettings::FixedFont);
    int fixedFontSize = defaultSettings->fontSize(QWebEngineSettings::DefaultFixedFontSize);
    QFont fixedFont = QFont(fixedFontFamily, fixedFontSize);
    fixedFont = qvariant_cast<QFont>(settings.value(QLatin1String("fixedFont"), fixedFont));
    defaultSettings->setFontFamily(QWebEngineSettings::FixedFont, fixedFont.family());
    defaultSettings->setFontSize(QWebEngineSettings::DefaultFixedFontSize, fixedFont.pointSize());

    defaultSettings->setAttribute(QWebEngineSettings::JavascriptEnabled, settings.value(QLatin1String("enableJavascript"), true).toBool());
    defaultSettings->setAttribute(QWebEngineSettings::ScrollAnimatorEnabled, settings.value(QLatin1String("enableScrollAnimator"), true).toBool());

    defaultSettings->setAttribute(QWebEngineSettings::PluginsEnabled, settings.value(QLatin1String("enablePlugins"), true).toBool());

    defaultSettings->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);

    defaultProfile->setHttpUserAgent(settings.value(QLatin1String("httpUserAgent")).toString());
    defaultProfile->setHttpAcceptLanguage(settings.value(QLatin1String("httpAcceptLanguage")).toString());

    settings.endGroup();

    settings.beginGroup(QLatin1String("proxy"));
    QNetworkProxy proxy;
    if (settings.value(QLatin1String("enabled"), false).toBool()) {
        if (settings.value(QLatin1String("type"), 0).toInt() == 0)
            proxy = QNetworkProxy::Socks5Proxy;
        else
            proxy = QNetworkProxy::HttpProxy;
        proxy.setHostName(settings.value(QLatin1String("hostName")).toString());
        proxy.setPort(settings.value(QLatin1String("port"), 1080).toInt());
        proxy.setUser(settings.value(QLatin1String("userName")).toString());
        proxy.setPassword(settings.value(QLatin1String("password")).toString());
    }
    QNetworkProxy::setApplicationProxy(proxy);
    settings.endGroup();
#endif
}

QList<BrowserMainWindow*> BrowserApplication::mainWindows()
{
    clean();
    QList<BrowserMainWindow*> list;
    for (int i = 0; i < m_mainWindows.count(); ++i)
        list.append(m_mainWindows.at(i));
    return list;
}

void BrowserApplication::clean()
{
    // cleanup any deleted main windows first
    for (int i = m_mainWindows.count() - 1; i >= 0; --i)
        if (m_mainWindows.at(i).isNull())
            m_mainWindows.removeAt(i);
}

QString BrowserApplication::generateSessionName()
{
    return nameTemplate.arg(nextSessionNameIndex++);
}

#if defined(Q_OS_OSX)
bool BrowserApplication::event(QEvent* event)
{
    switch (event->type()) {
    case QEvent::ApplicationActivate: {
        clean();
        if (!m_mainWindows.isEmpty() && ! headlessOption) {
            BrowserMainWindow *mw = mainWindow();
            if (mw && !mw->isMinimized()) {
                mainWindow()->show();
            }
            return true;
        }
    }
    case QEvent::FileOpen:
        if (!m_mainWindows.isEmpty()) {
            mainWindow()->loadPage(static_cast<QFileOpenEvent *>(event)->file());
            return true;
        }
    default:
        break;
    }
    return QApplication::event(event);
}
#endif

void BrowserApplication::openUrl(const QUrl &url)
{
    mainWindow()->loadPage(url.toString());
}

BrowserMainWindow *BrowserApplication::newMainWindow(const QString& url, int width, int height, const QString& position, bool headless, bool titlebar, QSharedDataPointer<ProcessOptions> processOptions)
{
    QUrl xurl = url;


    // Check if this is a 'file://.../start-WNUM.html' bridge URL from DomTerm
    // (used to make sure browser has read permission to user's files).
    // If so, read the file to extract the real url.
    // This avoids issues with file URLs - and might be slightly faster.
    QRegularExpression filePattern("^file://(.*/start[^/]*.html)$");
    QRegularExpressionMatch fileMatch = filePattern.match(url);
    if (fileMatch.hasMatch()) {
        QString fileName = fileMatch.captured(1);
        QFile fileFile(fileName);
        if (fileFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
            QTextStream fileStream(&fileFile);
            QRegularExpression urlPattern("location.replace.'([^']*)'.;$");
            for (;;) {
                QString line = fileStream.readLine();
                if (line.isNull())
                    break;
                QRegularExpressionMatch urlMatch = urlPattern.match(line);
                if (urlMatch.hasMatch()) {
                    xurl = urlMatch.captured(1);
                }
            }
        }
    }

    QUrlQuery fragment = QUrlQuery(xurl.fragment());
#if USE_KDDockWidgets || USE_DOCK_MANAGER
    if (! fragment.hasQueryItem("qtdocking")) {
#if USE_KDDockWidgets
        fragment.addQueryItem("qtdocking", "KDDockWidgets");
#endif
#if USE_DOCK_MANAGER
        fragment.addQueryItem("qtdocking", "QtAdvancedDockingSystem");
#endif
    }
#endif
    xurl.setFragment(fragment.isEmpty() ? QString()
                        : fragment.toString());
    Qt::WindowFlags wflags = Qt::Window;
    if (! titlebar)
        wflags |= Qt::FramelessWindowHint;
    BrowserMainWindow *browser =
        new BrowserMainWindow(this, xurl.toString(),
                              processOptions, nullptr, wflags);
    int x = -1, y = -1;
    if (! position.isEmpty()) {
        QRegularExpression re("^([-+])([0-9]+)([-+])([0-9]+)$");
        QRegularExpressionMatch match = re.match(position);
        if (match.hasMatch()) {
            x = match.captured(2).toInt();
            y = match.captured(4).toInt();
            bool xneg = match.captured(1) == "-";
            bool yneg = match.captured(3) == "-";
            if (xneg || yneg) {
                QSize screenSize = primaryScreen()->size();
                if (xneg)
                    x = screenSize.width() + x - width;
                if (yneg)
                    y = screenSize.height() + y - height;
            }
        }
    }
    if (width > 0 || height > 0) {
        if (x >= 0 && y >= 0)
            browser->setGeometry(x, y, width, height);
        else
            browser->setSize(width, height);
    }
    m_mainWindows.prepend(browser);
    if (! headless)
        browser->show();
    return browser;
}

BrowserMainWindow *BrowserApplication::newMainWindow(const QString& url, QSharedDataPointer<ProcessOptions> processOptions)
{
    QString w, h, pos;
    QString location = "";
    QString geometry = processOptions->geometry;
    if (! geometry.isEmpty()) {
        QRegularExpression re;
        QRegularExpressionMatch match;
        re.setPattern("^([0-9]+)x([0-9]+)([-+][0-9]+[-+][0-9]+)?$");
        match = re.match(geometry);
        if (match.hasMatch()) {
            w = match.captured(1);
            h = match.captured(2);
            pos = match.captured(3);
        } else {
            re.setPattern("^([-+][0-9]+[-+][0-9]+)$");
            match = re.match(geometry);
            if (match.hasMatch())
                pos = match.captured(1);
        }
    }
    return newMainWindow(url,
                         w.isEmpty() ? -1 : w.toInt(),
                         h.isEmpty() ? -1 : h.toInt(),
                         pos, headlessOption, processOptions->titlebar,
                         processOptions);
}

#if USE_KDDockWidgets || USE_DOCK_MANAGER
static int wcounter = 0;
QString
BrowserApplication::uniqueNameFromUrl(const QString& /*url*/)
{
    // FIXME
    char buf[20];
    sprintf(buf, "DT-%d", ++wcounter);
    return QString(buf);
}
#endif

BrowserMainWindow *BrowserApplication::mainWindow()
{
    clean();
    //if (m_mainWindows.isEmpty())
    //    newMainWindow();
    return m_mainWindows[0];
}

QNetworkAccessManager *BrowserApplication::networkAccessManager()
{
    if (!s_networkAccessManager) {
        s_networkAccessManager = new QNetworkAccessManager();
    }
    return s_networkAccessManager;
}

QIcon BrowserApplication::icon(const QUrl &url) const
{
#if defined(QTWEBENGINE_ICONDATABASE)
    QIcon icon = QWebEngineSettings::iconForUrl(url);
    if (!icon.isNull())
        return icon.pixmap(16, 16);
#else
    Q_UNUSED(url);
#endif
    return defaultIcon();
}

QIcon BrowserApplication::defaultIcon() const
{
    if (m_defaultIcon.isNull())
        m_defaultIcon = QIcon(QLatin1String(":defaulticon.png"));
    return m_defaultIcon;
}

ProcessOptions::ProcessOptions()
    : headless(false)
{
}
QDataStream& operator<<(QDataStream& stream, const ProcessOptions& state)
{
    stream << state.url;
    stream << state.wsconnect;
    stream << state.geometry;
    return stream;
}
QDataStream& operator>>(QDataStream& stream, ProcessOptions& state)
{
    stream >> state.url;
    stream >> state.wsconnect;
    stream >> state.geometry;
    return stream;
}

void
BrowserApplication::registerPane(int windowNumber, WebView*pane)
{
    if (windowNumber >= paneMap.size() && windowNumber >= 0) {
        paneMap.resize(windowNumber+10);
    }
    paneMap[windowNumber] = pane;
}

void
BrowserApplication::closePane(int windowNumber)
{
    if (windowNumber < paneMap.size() && windowNumber >= 0) {
        auto webv = paneMap[windowNumber];
        if (webv) {
            delete webv;
            paneMap[windowNumber] = nullptr;
        }
    }
}

void
BrowserApplication::focusPane(int windowNumber)
{
    if (windowNumber < paneMap.size() && windowNumber >= 0) {
        auto webv = paneMap[windowNumber];
        if (webv) {
            webv->setFocus();
        }
    }
}

void
BrowserApplication::showPane(int windowNumber, bool visible)
{
    if (windowNumber < paneMap.size() && windowNumber >= 0) {
        auto webv = paneMap[windowNumber];
        if (webv) {
            webv->setVisible(visible);
        }
    }
}

void BrowserApplication::sendChildMessage(int windowNumber, const QString& command, const QString& args_json)
{
    if (windowNumber < paneMap.size()) {
        auto webv = dynamic_cast<WebView*>(paneMap[windowNumber]);
        if (webv) {
            emit webv->backend()->forwardToChildWindow(command, args_json);
        }
    }
}

void BrowserApplication::lowerOrRaisePanes(bool raise, bool allWindows, BrowserMainWindow *mainWindow)
{
    for (int windowNum = paneMap.size(); --windowNum >= 0; ) {
        QWidget *pane = paneMap[windowNum];
        if (pane && (allWindows || pane->parent() == mainWindow)) {
            if (raise)
                pane->raise();
            else
                pane->lower();
        }
    }
}

void BrowserApplication::setMainZoom(qreal zoom, BrowserMainWindow *mainWindow)
{
    int npanes = paneMap.size();
    mainWindow->_mainZoom = zoom;
    WebView *mainWeb = mainWindow->webView();
    for (int windowNum = 0; ; windowNum++ ) {
        WebView *webv = windowNum == npanes ? mainWeb
            : dynamic_cast<WebView*>(paneMap[windowNum]);
        if (windowNum == npanes || (webv && webv->parent() == mainWeb)) {
            webv->setZoomFactor(zoom * webv->paneZoom);
        }
        if (windowNum == npanes)
            break;
    }
}
