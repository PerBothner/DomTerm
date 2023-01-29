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
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

#include <QtGui/QDesktopServices>
#include <QtGui/QFileOpenEvent>
#include <QtWidgets/QMenuBar>
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
    , m_processOptions(processOptions)
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
    socket.connectToServer(serverName); // probably OBSOLETE
    if (socket.waitForConnected(500)) {
        QDataStream stream(&socket);
        stream << *processOptions;
        socket.waitForBytesWritten();
        return;
    }

#if defined(Q_OS_MACOS)
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
    if (! processOptions->commandSocket.isEmpty()) {
        cmdSocket = new QLocalSocket(this);
        cmdSocket->connectToServer(processOptions->commandSocket);
        connect(cmdSocket, &QLocalSocket::readyRead, this, &BrowserApplication::onCmdReadyRead);

        QJsonObject jobject;
        QJsonArray argv;
        argv += QJsonValue("-");
        argv += QJsonValue("++internal-frontend");
        argv += QJsonValue(QString("%1").arg(m_processOptions->appNumber));
        QJsonObject values;
        values.insert("argv", argv);
        QJsonDocument jdocument(values);
        QByteArray jbytes = jdocument.toJson(QJsonDocument::Compact);
        jbytes.append('\f');
        cmdSend(jbytes);
    }

    QTimer::singleShot(0, this, SLOT(postLaunch()));
    initActions();

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
#if defined(Q_OS_MACOS)
    initMenubar(nullptr);
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

void BrowserApplication::cmdSend(const QString& cmd)
{
    cmdSocket->write(cmd.toStdString().c_str());
    cmdSocket->flush();
}
void BrowserApplication::cmdSend(const QByteArray& message)
{
    cmdSocket->write(message);
    cmdSocket->flush();
}

void BrowserApplication::cmdSendLine(const QString& cmd)
{
    this->cmdSend(cmd + "\n");
}

void BrowserApplication::onCmdReadyRead()
{
    for (;;) {
        auto bavail = cmdSocket->bytesAvailable();
        if (bavail <= 0)
            break;
        char buf[200];
        auto n = cmdSocket->read(buf, (qint64) sizeof(buf) > (qint64) bavail ? bavail : sizeof(buf));
        if (n <= 0)
            break; // ERROR
        cmdBuffer.append(buf, n);
    }
    for (;;) {
        char *data = cmdBuffer.data();
        char *eol = strchr(data, '\n');
        if (eol == nullptr)
            break;
        qint64 len = eol - data;
        char *sp = strchr(data, ' ');
        QString cmd, arg;
        if (sp && sp - data < len) {
            cmd = QString::fromUtf8(data, sp - data);
            sp++; // skip space
            arg = QString::fromUtf8(sp, eol - sp);
        } else {
            cmd = QString::fromUtf8(data, len);
            arg = "";
        }
        cmdDo(cmd, arg);
        cmdBuffer.remove(0, len+1);
    }
}

void BrowserApplication::quitBrowser()
{
}

void BrowserApplication::cmdDo(const QString& cmd, const QString& arg)
{
    if (cmd == "OPEN-WINDOW") {
        newMainWindow(m_processOptions, arg);
    }
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

static QKeySequence simpleCmdKey(Qt::Key baseChar)
{
#if defined(Q_OS_MACOS)
    return QKeySequence(Qt::CTRL /* actually Cmd */ | baseChar);
#else
    return QKeySequence(Qt::CTRL | Qt::SHIFT | baseChar);
#endif
}

void BrowserApplication::initActions()
{
    copyAction = new NamedAction(tr("&Copy"), this, "copy-text");
    copyAction->setShortcut(simpleCmdKey(Qt::Key_C));
    pasteAction = new NamedAction(tr("&Paste"), this, "paste-text");
    pasteAction->setShortcut(QKeySequence(simpleCmdKey(Qt::Key_V)));

    togglePagingAction = new NamedAction("Automatic &Pager", this, "toggle-auto-pager");
    togglePagingAction->setCheckable(true);
    detachAction = new NamedAction("&Detach", this, "detach-session");
    aboutAction =  new NamedAction(tr("About QtDomTerm"), this, "show-about-message");
    aboutAction->setMenuRole(QAction::AboutRole);

    newTerminalMenu = new QMenu(tr("New Terminal"), nullptr);
    newTerminalWindowAction =
        new NamedAction(tr("&New Window"), this, "new-window",
                        simpleCmdKey(Qt::Key_N));
    newTerminalMenu->addAction(newTerminalWindowAction);
    newTerminalTabAction = new NamedAction(tr("New terminal tab"), this, "new-tab", simpleCmdKey(Qt::Key_T));
    newTerminalMenu->addAction(newTerminalTabAction);
    QAction *newTerminalPane = new NamedAction(tr("New terminal (right/above)"), this, "new-pane");
    newTerminalMenu->addAction(newTerminalPane);
    QAction *newTerminalAbove = new NamedAction(tr("New terminal above"), this, "new-pane-above");
    newTerminalMenu->addAction(newTerminalAbove);
    QAction *newTerminalBelow = new NamedAction(tr("New terminal below"), this, "new-pane-below");
    newTerminalMenu->addAction(newTerminalBelow);
    QAction *newTerminalLeft = new NamedAction(tr("New terminal left"), this, "new-pane-left");
    newTerminalMenu->addAction(newTerminalLeft);
    QAction *newTerminalRight = new NamedAction(tr("New terminal right"), this, "new-pane-right");
    newTerminalMenu->addAction(newTerminalRight);
    saveAsHtmlAction = new NamedAction(tr("Save As"), this, "save-as-html",
                                       QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_S));
}

void BrowserApplication::initMenubar(BrowserMainWindow *window)
{
    QMenuBar *menuBar = window ? window->menuBar() : new QMenuBar();
    //connect(menuBar()->toggleViewAction(), SIGNAL(toggled(bool)),
    //            this, SLOT(updateMenubarActionText(bool)));

    // File
    QMenu *fileMenu = menuBar->addMenu(tr("&File"));

    fileMenu->addAction(newTerminalWindowAction);
    fileMenu->addAction(newTerminalTabAction);
    fileMenu->addAction(saveAsHtmlAction);
    fileMenu->addSeparator();
    fileMenu->addAction(new NamedAction("Close session", this, "close-pane",
                                        simpleCmdKey(Qt::Key_W)));
    fileMenu->addAction(new NamedAction("Quit", this, "quit-domterm",
                                        simpleCmdKey(Qt::Key_Q)));

    // Edit
    QMenu *editMenu = menuBar->addMenu(tr("&Edit"));
    editMenu->addAction(copyAction);
    editMenu->addAction(new NamedAction(tr("Copy as HTML"), this, "copy-html"));
    editMenu->addAction(pasteAction);
    editMenu->addAction(new NamedAction(tr("Clear Buffer"), this,
                                        "clear-buffer"));
    editMenu->addSeparator();

    editMenu->addAction(new NamedAction(tr("&Find"), this,
                                        "find-text",
                                        simpleCmdKey(Qt::Key_F)));

    // View
    QMenu *viewMenu = menuBar->addMenu(tr("&View"));

    if (window) {
        QAction *viewMenubarAction = new NamedAction("Hide menubar",
                                                     this, "toggle-menubar");
        window->viewMenubarAction = viewMenubarAction;
        window->updateMenubarActionText(true);
        viewMenu->addAction(viewMenubarAction);
    }

    viewMenu->addAction(new NamedAction(tr("Zoom &In"), this, "window-zoom-in", QKeySequence(Qt::CTRL | Qt::Key_Plus)));
    viewMenu->addAction(new NamedAction(tr("Zoom &Out"), this, "window-zoom-out", QKeySequence(Qt::CTRL | Qt::Key_Minus)));
    viewMenu->addAction(new NamedAction(tr("Reset &Zoom"), this, "window-zoom-reset", QKeySequence(Qt::CTRL | Qt::Key_0)));
    viewMenu->addAction(new NamedAction(tr("Zoom &In (pane)"), this, "pane-zoom-in", QKeySequence(Qt::ALT | Qt::CTRL | Qt::Key_Plus)));
    viewMenu->addAction(new NamedAction(tr("Zoom &Out (pane)"), this, "pane-zoom-out", QKeySequence(Qt::ALT | Qt::CTRL | Qt::Key_Minus)));
    viewMenu->addAction(new NamedAction(tr("Reset &Zoom (pane)"), this, "pane-zoom-reset", QKeySequence(Qt::ALT | Qt::CTRL | Qt::Key_0)));

    auto a = new NamedAction(tr("&Full Screen"), this, "toggle-fullscreen",
                             QKeySequence(Qt::Key_F11));
    a->setCheckable(true);
    viewMenu->addAction(a);

#if 1
    //QMenu *toolsMenu = menuBar->addMenu(tr("&Tools"));
#if defined(QWEBENGINEINSPECTOR)
    a = viewMenu->addAction(tr("Enable Web &Inspector"), this, SLOT(slotToggleInspector(bool)));
    a->setCheckable(true);
#endif
#endif

    QMenu *terminalMenu = menuBar->addMenu(tr("&Terminal"));
    terminalMenu->addAction(new NamedAction("Cycle input mode", this,
                                            "input-mode-cycle",
                                            QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_L)));
    terminalMenu->addAction(togglePagingAction);
    terminalMenu->addMenu(newTerminalMenu);
    terminalMenu->addAction(detachAction);

    QMenu *helpMenu = menuBar->addMenu(tr("&Help"));
    helpMenu->addAction(aboutAction);
    helpMenu->addAction(new NamedAction(tr("DomTerm home page"), this,
                                        "open-domterm-homepage"));
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

#if defined(Q_OS_MACOS)
bool BrowserApplication::event(QEvent* event)
{
    BrowserMainWindow *mw = currentWindow();
    switch (event->type()) {
    case QEvent::ApplicationActivate: {
        clean();
        if (mw != nullptr && ! headlessOption) {
            if (mw && !mw->isMinimized()) {
                mw->show();
            }
            return true;
        }
    }
    case QEvent::FileOpen:
        if (mw != nullptr) {
            mw->loadPage(static_cast<QFileOpenEvent *>(event)->file());
            return true;
        }
    default:
        break;
    }
    return QApplication::event(event);
}
#endif

void BrowserApplication::showAboutMessage(BrowserMainWindow* parent)
{
    QMessageBox::about(parent, tr("About QtDomTerm"), tr(
        "<p><b>DomTerm</b> is terminal emulator based on web technologies. "
        "Features include embedded graphics and html; tabs and sub-windows; detachable sessions.</p>"
        "<p>DomTerm version %1.</p>"
        "<p>This <b>QtDomTerm</b> front-end uses QtWebEngine %2.</p>"
        "<p>Website: <a href=\"https://domterm.org/\">https://domterm.org/</a>."
        "<p>Copyright %3 Per Bothner and others."
                           )
                       .arg(QCoreApplication::applicationVersion())
                       .arg(qVersion())
                       .arg(QTDOMTERM_YEAR)
        );
}

BrowserMainWindow *BrowserApplication::newMainWindow(QSharedDataPointer<ProcessOptions> processOptions, const QString& joptions)
{
    QJsonObject options = QJsonDocument::fromJson(joptions.toUtf8()).object();
    return newMainWindow(options.value("url").toString(),
                         options.value("width").toInt(0),
                         options.value("height").toInt(0),
                         options.value("position").toString(""),
                         options.value("windowNumber").toInt(-1),
                         options.value("headless").toBool(false),
                         options.value("titlebar").toString("") == "system",
                         processOptions);
}

BrowserMainWindow *BrowserApplication::newMainWindow(const QString& url, int width, int height, const QString& position, int windowNumber, bool headless, bool titlebar, QSharedDataPointer<ProcessOptions> processOptions)
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
            QRegularExpression urlPattern("location.replace.'(([^#]*)#[^']*server-key=([^'&]*)[^']*)'.;$");
            for (;;) {
                QString line = fileStream.readLine();
                if (line.isNull())
                    break;
                QRegularExpressionMatch urlMatch = urlPattern.match(line);
                if (urlMatch.hasMatch()) {
                    xurl = urlMatch.captured(1);
                    urlMainPart = urlMatch.captured(2);
                    serverKey = urlMatch.captured(3);
                }
            }
        }
    } else if (url.length() > 1 && url[0] == '#') {
        xurl = urlMainPart + url + "&server-key=" + serverKey;
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
                              processOptions, windowNumber, nullptr, wflags);
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

BrowserMainWindow *BrowserApplication::newMainWindow(const QString& url, QSharedDataPointer<ProcessOptions> processOptions) // FIXME maybe inline in main.
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
                         pos, processOptions->windowNumber, headlessOption,
                         processOptions->titlebar,
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

BrowserMainWindow *BrowserApplication::currentWindow()
{
    return m_currentWindow;
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
    , windowNumber(-1)
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
