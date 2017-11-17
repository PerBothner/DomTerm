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

#include <QtCore/QBuffer>
#include <QtCore/QDir>
#include <QtCore/QLibraryInfo>
#include <QtCore/QSettings>
#include <QtCore/QTextStream>
#include <QtCore/QTranslator>
#include <QtCore/QTimer>

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
#include <QFileSystemWatcher>
#include <QtCore/QDebug>

QNetworkAccessManager *BrowserApplication::s_networkAccessManager = 0;

BrowserApplication::BrowserApplication(int &argc, char **argv, char *styleSheet,QSharedDataPointer<ProcessOptions> processOptions)
    : QApplication(argc, argv)
    , m_localServer(0)
    , m_privateProfile(0)
    , sawStyleSheetCommandLineOption(false)
    , nextSessionNameIndex(1)
{
    nameTemplate = QLatin1String("domterm-%1");
    QCoreApplication::setOrganizationName(QLatin1String("DomTerm"));
    QCoreApplication::setApplicationName(QLatin1String("QtDomTerm"));
    QCoreApplication::setApplicationVersion(QLatin1String(QTDOMTERM_VERSION));
    QString serverName = QCoreApplication::applicationName()
        + QString::fromLatin1(QT_VERSION_STR).remove('.') + QLatin1String("webengine");

    if (styleSheet != NULL) {
        m_stylesheetFilename = QString(styleSheet);
        sawStyleSheetCommandLineOption = true;
    }
    m_fileSystemWatcher = new QFileSystemWatcher(this);

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

    m_localServer = new QLocalServer(this);
    connect(m_localServer, SIGNAL(newConnection()),
            this, SLOT(newLocalSocketConnection()));
    if (!m_localServer->listen(serverName)
            && m_localServer->serverError() == QAbstractSocket::AddressInUseError) {
        QLocalServer::removeServer(serverName);
        if (!m_localServer->listen(serverName))
            qWarning("Could not create local socket %s.", qPrintable(serverName));
    }

#ifndef QT_NO_OPENSSL
    if (!QSslSocket::supportsSsl()) {
    QMessageBox::information(0, "Demo Browser",
                 "This system does not support OpenSSL. SSL websites will not be available.");
    }
#endif

    QString localSysName = QLocale::system().name();

    installTranslator(QLatin1String("qt_") + localSysName);

    QTimer::singleShot(0, this, SLOT(postLaunch()));
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
#if defined(Q_OS_OSX)
    clean();
    int tabCount = 0;
    for (int i = 0; i < m_mainWindows.count(); ++i) {
        tabCount += m_mainWindows.at(i)->tabWidget()->count();
    }

    if (tabCount > 1) {
        int ret = QMessageBox::warning(mainWindow(), QString(),
                           tr("There are %1 windows and %2 tabs open\n"
                              "Do you want to quit anyway?").arg(m_mainWindows.count()).arg(tabCount),
                           QMessageBox::Yes | QMessageBox::No,
                           QMessageBox::No);
        if (ret == QMessageBox::No)
            return;
    }

    exit(0);
#endif
}

/*!
    Any actions that can be delayed until the window is visible
 */
void BrowserApplication::postLaunch()
{
    QString directory = QStandardPaths::writableLocation(QStandardPaths::DataLocation);
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

    if (! sawStyleSheetCommandLineOption) {
        m_stylesheetFilename = settings.value(QLatin1String("userStyleSheetFile")).toString();
        m_stylesheetRules = settings.value(QLatin1String("userStyleSheetRules")).toString();
        emit reloadStyleSheet();
    }
    if (! m_stylesheetFilename.isEmpty()) {
        m_fileSystemWatcher->addPath(m_stylesheetFilename);
        connect(m_fileSystemWatcher, &QFileSystemWatcher::fileChanged,
                this, &BrowserApplication::reloadStylesheet);
    }

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

bool BrowserApplication::isTheOnlyBrowser() const
{
    return (m_localServer != 0);
}

QString BrowserApplication::generateSessionName()
{
    return nameTemplate.arg(nextSessionNameIndex++);
}

void BrowserApplication::reloadStylesheet()
{
    QString filename = stylesheetFilename();
    if (! filename.isEmpty()) {
        QFile file(filename);
        if (file.open(QFile::ReadOnly | QFile::Text)) {
            QTextStream text(&file);
            setStyleSheet(text.readAll());
        }
    }
}

void BrowserApplication::installTranslator(const QString &name)
{
    QTranslator *translator = new QTranslator(this);
    translator->load(name, QLibraryInfo::location(QLibraryInfo::TranslationsPath));
    QApplication::installTranslator(translator);
}

#if defined(Q_OS_OSX)
bool BrowserApplication::event(QEvent* event)
{
    switch (event->type()) {
    case QEvent::ApplicationActivate: {
        clean();
        if (!m_mainWindows.isEmpty()) {
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

BrowserMainWindow *BrowserApplication::newMainWindow(const QString& url, QSharedDataPointer<ProcessOptions> processOptions)
{
    BrowserMainWindow *browser = new BrowserMainWindow(url, processOptions);
    m_mainWindows.prepend(browser);
    browser->show();
    return browser;
}

BrowserMainWindow *BrowserApplication::mainWindow()
{
    clean();
    //if (m_mainWindows.isEmpty())
    //    newMainWindow();
    return m_mainWindows[0];
}

void BrowserApplication::newLocalSocketConnection()
{
    QLocalSocket *socket = m_localServer->nextPendingConnection();
    if (!socket)
        return;
    socket->waitForReadyRead(1000);
    QDataStream stream(socket);
    QSharedDataPointer<ProcessOptions> processOptions(new ProcessOptions());
    stream >> *processOptions;
    QString url = processOptions->url;
    if (!url.isEmpty()) {
      newMainWindow(url, processOptions);
        openUrl(url);
    }
    delete socket;
    mainWindow()->raise();
    mainWindow()->activateWindow();
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
{
}
QDataStream& operator<<(QDataStream& stream, const ProcessOptions& state)
{
    stream << state.url;
    stream << state.wsconnect;
    return stream;
}
QDataStream& operator>>(QDataStream& stream, ProcessOptions& state)
{
    stream >> state.url;
    stream >> state.wsconnect;
    return stream;
}

