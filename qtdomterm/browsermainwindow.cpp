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

#include "browsermainwindow.h"

#include "browserapplication.h"
#include "webview.h"
#include "backend.h"
#include "processoptions.h"

#include <QtCore/QSettings>
#include <QtGui/QDesktopServices>
#include <QtWidgets/QFileDialog>
#include <QtWidgets/QPlainTextEdit>
#include <QtWidgets/QMenuBar>
#include <QtWidgets/QDialog>
#include <QtWidgets/QInputDialog>

#include <QWebEngineProfile>
#include <QWebEngineSettings>
#include <QVBoxLayout>
#include <QUrl>
#include <QUrlQuery>
#include <QShortcut>
#include <QAction>
#include <QActionGroup>
#include <QtCore/QDebug>
#include <stdio.h>

NamedAction::NamedAction(const QString &text, BrowserApplication *app, const char *cmd)
: QAction(text), application(app), command(cmd)
{
    connect(this, &QAction::triggered, this, &NamedAction::doit);
}
NamedAction::NamedAction(const QString &text, BrowserApplication *app, const char *cmd, const QKeySequence &shortcut)
    : QAction(text), application(app), command(cmd)
{
    setShortcut(shortcut);
    connect(this, &QAction::triggered, this, &NamedAction::doit);
}
NamedAction::NamedAction(const QString &text, BrowserApplication *app, QObject *parent, const char *cmd)
    : QAction(text, parent), application(app), command(cmd)
{
    connect(this, &QAction::triggered, this, &NamedAction::doit);
}
NamedAction::NamedAction(const QString &text, BrowserApplication *app, QObject *parent, const char *cmd, const QKeySequence &shortcut)
    : QAction(text, parent), application(app), command(cmd)
{
    setShortcut(shortcut);
    connect(this, &QAction::triggered, this, &NamedAction::doit);
}

void NamedAction::doit()
{
    BrowserMainWindow *window = application->currentWindow();
    if (this == application->aboutAction) {
        application->showAboutMessage(window);
        return;
    }
    if (window != nullptr)
        window->slotSimpleCommand(command);
    else {
        printf("ACTION %s\n", command.toStdString().c_str());
        fflush(stdout);
    }
}

BrowserMainWindow::BrowserMainWindow(BrowserApplication* application,
                                     const QString& url, QSharedDataPointer<ProcessOptions> processOptions, int windowNumber, QWidget *parent,
                                     Qt::WindowFlags wflags
    )
#if USE_KDDockWidgets
    : KDDockWidgets::MainWindow(BrowserApplication::uniqueNameFromUrl(url), KDDockWidgets::MainWindowOption_None, parent)
#else
    : QMainWindow(parent, wflags)
#endif
    , m_application(application)
#if USE_KDDockWidgets
    , m_webView(new WebView(processOptions, windowNumber, nullptr))
#else
    , m_webView(new WebView(processOptions, windowNumber, this))
#endif
    , m_width(-1)
    , m_height(-1)
{
#if USE_DOCK_MANAGER && !ADS_MULTI_MAIN_WINDOW
    ads::CDockManager::setConfigFlags(ads::CDockManager::AlwaysShowTabs);
    m_DockManager = new ads::CDockManager(this);
#endif
    setToolButtonStyle(Qt::ToolButtonFollowStyle);
    setAttribute(Qt::WA_DeleteOnClose, true);
    if ((wflags & Qt::FramelessWindowHint) != 0)
        setAttribute(Qt::WA_TranslucentBackground);
    _usingQtMenus = (
#if defined(Q_OS_MACOS)
        true
#else
        (wflags & Qt::FramelessWindowHint) == 0
#endif
        );
#if ! defined(Q_OS_MACOS)
    if (usingQtMenus())
        application->initMenubar(this);
#endif
    m_webView->newPage(url);
#if USE_KDDockWidgets || USE_DOCK_MANAGER
    auto dockw = m_webView->setDockWidget(BrowserApplication::uniqueNameFromUrl(url));
#if USE_KDDockWidgets
    this->addDockWidget(dockw, KDDockWidgets::Location_OnLeft);
#endif
#if USE_DOCK_MANAGER
#if ADS_MULTI_MAIN_WINDOW
    ads::CDockContainerWidget* container = BrowserApplication::instance()->dockManager()->addContainer(this);
    container->addDockWidget(ads::TopDockWidgetArea, dockw, nullptr);
#else
    m_DockManager->addDockWidget(ads::TopDockWidgetArea, dockw, nullptr);
#endif
#endif
#else /* neither USE_KDDockWidgets or USE_DOCK_MANAGER */
    QWidget *centralWidget = new QWidget(this);
    QVBoxLayout *layout = new QVBoxLayout;
    layout->setSpacing(0);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->addWidget(m_webView);
    centralWidget->setLayout(layout);
    setCentralWidget(centralWidget);
#endif
    slotUpdateWindowTitle();
    loadDefaultState();
    m_webView->page()->setBackgroundColor(Qt::transparent);
}

BrowserMainWindow::~BrowserMainWindow()
{
}

BrowserMainWindow* BrowserMainWindow::containingMainWindow(QWidget *widget)
{
    for (QObject *w = widget; w; w = w->parent()) {
        if (BrowserMainWindow *mw = qobject_cast<BrowserMainWindow*>(w))
            return mw;
    }
    return nullptr;
}

void BrowserMainWindow::loadDefaultState()
{
    QSettings settings;
    settings.beginGroup(QLatin1String("BrowserMainWindow"));
    QByteArray data = settings.value(QLatin1String("defaultState")).toByteArray();
    settings.endGroup();
}

QSize BrowserMainWindow::sizeHint() const
{
    if (m_width > 0 || m_height > 0)
        return QSize(m_width, m_height);
#if 0
    return QApplication::desktop()->screenGeometry() * qreal(0.4);
#else
    return QSize(800, 600);
#endif
}

void BrowserMainWindow::showMenubar()
{
#if ! defined(Q_OS_MACOS)
    showMenubar(! menuBar()->isVisible());
#endif
}
void BrowserMainWindow::showMenubar(bool show)
{
#if ! defined(Q_OS_MACOS)
    updateMenubarActionText(show);
    if (show) {
        menuBar()->show();
    } else {
        menuBar()->hide();
    }
#endif
}

void BrowserMainWindow::updateMenubarActionText(bool visible)
{
    viewMenubarAction->setText(!visible ? tr("Show Menubar") : tr("Hide Menubar"));
}

void BrowserMainWindow::loadUrl(const QUrl &url)
{
    if (! webView() || !url.isValid())
        return;

    m_webView->loadUrl(url);
    m_webView->setFocus();
}

void BrowserMainWindow::slotUpdateWindowTitle(const QString &title)
{
    if (title.isEmpty()) {
        setWindowTitle(tr("QtDomTerm"));
    } else {
        setWindowTitle(title);
    }
}

void  BrowserMainWindow::slotSimpleCommand(const QString &command)
{
    emit webView()->backend()->handleSimpleCommand(command);
}

void BrowserMainWindow::closeEvent(QCloseEvent *event)
{
    event->accept();
    printf("CLOSE-WINDOW %d\n", webView()->windowNumber());
    fflush(stdout);
    deleteLater();
}

void BrowserMainWindow::changeEvent(QEvent * e) {
    if (e->type() == QEvent::ActivationChange) {
        BrowserApplication *app = application();
        if (this->isActiveWindow())
            app->m_currentWindow = this;
        else if (app->m_currentWindow == this)
            app->m_currentWindow = nullptr;
    }
}


void BrowserMainWindow::slotViewFullScreen(bool makeFullScreen)
{
    if (makeFullScreen) {
        showFullScreen();
    } else {
        if (isMinimized())
            showMinimized();
        else if (isMaximized())
            showMaximized();
        else showNormal();
    }
}

void BrowserMainWindow::slotToggleInspector(bool enable)
{
#if defined(QWEBENGINEINSPECTOR)
    QWebEngineSettings::globalSettings()->setAttribute(QWebEngineSettings::DeveloperExtrasEnabled, enable);
#else
    Q_UNUSED(enable);
#endif
}

void BrowserMainWindow::loadPage(const QString &page)
{
    QUrl url = QUrl::fromUserInput(page);
    loadUrl(url);
}

WebView *BrowserMainWindow::webView() const
{
    return m_webView;
}

void BrowserMainWindow::slotShowWindow()
{
    if (QAction *action = qobject_cast<QAction*>(sender())) {
        QVariant v = action->data();
        if (v.canConvert<int>()) {
            int offset = qvariant_cast<int>(v);
            QList<BrowserMainWindow*> windows = BrowserApplication::instance()->mainWindows();
            windows.at(offset)->activateWindow();
            windows.at(offset)->webView()->setFocus();
        }
    }
}

void BrowserMainWindow::slotOpenActionUrl(QAction *)
{
}

void BrowserMainWindow::geometryChangeRequested(const QRect &geometry)
{
    setGeometry(geometry);
}
