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
#include "settings.h"
#include "tabwidget.h"
#include "webview.h"
#include "processoptions.h"

#include <QtCore/QSettings>

#include <QtWidgets/QDesktopWidget>
#include <QtWidgets/QFileDialog>
#include <QtWidgets/QPlainTextEdit>
#include <QtWidgets/QMenuBar>
#include <QtWidgets/QMessageBox>
#include <QtWidgets/QInputDialog>

#include <QWebEngineHistory>
#include <QWebEngineProfile>
#include <QWebEngineSettings>

#include <QtCore/QDebug>

template<typename Arg, typename R, typename C>
struct InvokeWrapper {
    R *receiver;
    void (C::*memberFun)(Arg);
    void operator()(Arg result) {
        (receiver->*memberFun)(result);
    }
};

template<typename Arg, typename R, typename C>
InvokeWrapper<Arg, R, C> invoke(R *receiver, void (C::*memberFun)(Arg))
{
    InvokeWrapper<Arg, R, C> wrapper = {receiver, memberFun};
    return wrapper;
}

BrowserMainWindow::BrowserMainWindow(QSharedDataPointer<ProcessOptions> processOptions, QWidget *parent, Qt::WindowFlags flags)
    : QMainWindow(parent, flags)
    , m_tabWidget(new TabWidget(this))
    , m_historyBack(0)
    , m_historyForward(0)
    , m_stop(0)
{
    setToolButtonStyle(Qt::ToolButtonFollowStyle);
    setAttribute(Qt::WA_DeleteOnClose, true);
    setupMenu();

    QWidget *centralWidget = new QWidget(this);
    QVBoxLayout *layout = new QVBoxLayout;
    layout->setSpacing(0);
    layout->setMargin(0);
    layout->addWidget(m_tabWidget);
    centralWidget->setLayout(layout);
    setCentralWidget(centralWidget);

    connect(m_tabWidget, SIGNAL(loadPage(QString)),
        this, SLOT(loadPage(QString)));
    connect(m_tabWidget, &TabWidget::setCurrentTitle,
            this, &BrowserMainWindow::slotUpdateWindowTitle);
    connect(m_tabWidget, SIGNAL(geometryChangeRequested(QRect)),
            this, SLOT(geometryChangeRequested(QRect)));
    connect(m_tabWidget, SIGNAL(menuBarVisibilityChangeRequested(bool)),
            menuBar(), SLOT(setVisible(bool)));
    connect(m_tabWidget, SIGNAL(lastTabClosed()),
            this, SLOT(close()));

    slotUpdateWindowTitle();
    loadDefaultState();
    m_tabWidget->newTab(processOptions);
}

BrowserMainWindow::~BrowserMainWindow()
{
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
    QRect desktopRect = QApplication::desktop()->screenGeometry();
    QSize size = desktopRect.size() * qreal(0.9);
    return size;
}

void BrowserMainWindow::runScriptOnOpenViews(const QString &source)
{
    for (int i = 0; i < tabWidget()->count(); ++i)
        tabWidget()->webView(i)->page()->runJavaScript(source);
}

void BrowserMainWindow::setupMenu()
{
    new QShortcut(QKeySequence(Qt::Key_F6), this, SLOT(slotSwapFocus()));
    //connect(menuBar()->toggleViewAction(), SIGNAL(toggled(bool)),
    //            this, SLOT(updateMenubarActionText(bool)));

    // File
    QMenu *fileMenu = menuBar()->addMenu(tr("&File"));

    fileMenu->addAction(tr("&New Window"), this, SLOT(slotFileNew()),
                        QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_N));
    fileMenu->addAction(m_tabWidget->newTabAction());
    fileMenu->addSeparator();
    fileMenu->addAction(m_tabWidget->closeTabAction());
    fileMenu->addSeparator();
    fileMenu->addAction(m_tabWidget->saveAsAction());
    fileMenu->addSeparator();

#if defined(Q_OS_OSX)
    fileMenu->addAction(tr("&Quit"), BrowserApplication::instance(), SLOT(quitBrowser()), QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Q));
#else
    fileMenu->addAction(tr("&Quit"), this, SLOT(close()), QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Q));
#endif

    // Edit
    QMenu *editMenu = menuBar()->addMenu(tr("&Edit"));
    QAction *m_copy = editMenu->addAction(tr("&Copy"));
    m_copy->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_C));
    m_tabWidget->addWebAction(m_copy, QWebEnginePage::Copy);
    QAction *m_paste = editMenu->addAction(tr("&Paste"));
    m_paste->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_V));
    m_tabWidget->addWebAction(m_paste, QWebEnginePage::Paste);
    editMenu->addSeparator();

    QAction *m_find = editMenu->addAction(tr("&Find"));
    m_find->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_F));
    connect(m_find, SIGNAL(triggered()), this, SLOT(slotEditFind()));
    QAction *m_findNext = editMenu->addAction(tr("&Find Next"));
    //m_findNext->setShortcuts(QKeySequence::FindNext);
    connect(m_findNext, SIGNAL(triggered()), this, SLOT(slotEditFindNext()));

    QAction *m_findPrevious = editMenu->addAction(tr("&Find Previous"));
    //m_findPrevious->setShortcuts(QKeySequence::FindPrevious);
    connect(m_findPrevious, SIGNAL(triggered()), this, SLOT(slotEditFindPrevious()));
    editMenu->addSeparator();

    editMenu->addAction(tr("&Preferences"), this, SLOT(slotPreferences()), tr("Ctrl+,"));

    // View
    QMenu *viewMenu = menuBar()->addMenu(tr("&View"));

    m_viewMenubar = new QAction(this);
    updateMenubarActionText(true);
    connect(m_viewMenubar, SIGNAL(triggered()), this, SLOT(slotViewMenubar()));
    viewMenu->addAction(m_viewMenubar);

    m_stop = viewMenu->addAction(tr("&Stop"));
    QList<QKeySequence> shortcuts;
    shortcuts.append(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Period));
    shortcuts.append(Qt::Key_Escape);
    m_stop->setShortcuts(shortcuts);
    m_tabWidget->addWebAction(m_stop, QWebEnginePage::Stop);

    viewMenu->addAction(tr("Zoom &In"), this, SLOT(slotViewZoomIn()), QKeySequence(Qt::CTRL | Qt::Key_Plus));
    viewMenu->addAction(tr("Zoom &Out"), this, SLOT(slotViewZoomOut()), QKeySequence(Qt::CTRL | Qt::Key_Minus));
    viewMenu->addAction(tr("Reset &Zoom"), this, SLOT(slotViewResetZoom()), QKeySequence(Qt::CTRL | Qt::Key_0));

    QAction *a = viewMenu->addAction(tr("&Full Screen"), this, SLOT(slotViewFullScreen(bool)),  Qt::Key_F11);
    a->setCheckable(true);

    // Window
    m_windowMenu = menuBar()->addMenu(tr("&Window"));
    connect(m_windowMenu, SIGNAL(aboutToShow()),
            this, SLOT(slotAboutToShowWindowMenu()));
    slotAboutToShowWindowMenu();

#if 0
    QMenu *toolsMenu = menuBar()->addMenu(tr("&Tools"));
#if defined(QWEBENGINEINSPECTOR)
    a = toolsMenu->addAction(tr("Enable Web &Inspector"), this, SLOT(slotToggleInspector(bool)));
    a->setCheckable(true);
#endif
#endif

    QMenu *terminalMenu = menuBar()->addMenu(tr("&Terminal"));
    terminalMenu->addAction(m_tabWidget->changeCaretAction());

    QMenu *helpMenu = menuBar()->addMenu(tr("&Help"));
    //helpMenu->addAction(tr("About &Qt"), qApp, SLOT(aboutQt()));
    helpMenu->addAction(tr("About QtDomTerm"), this, SLOT(slotAboutApplication()));
}

void BrowserMainWindow::slotViewMenubar()
{
    if (menuBar()->isVisible()) {
        updateMenubarActionText(false);
        menuBar()->hide();
    } else {
        updateMenubarActionText(true);
        menuBar()->show();
    }
}

void BrowserMainWindow::handleFindTextResult(bool /*found*/)
{
}

void BrowserMainWindow::updateMenubarActionText(bool visible)
{
    m_viewMenubar->setText(!visible ? tr("Show Menubar") : tr("Hide Menubar"));
}

void BrowserMainWindow::loadUrl(const QUrl &url)
{
    if (!currentTab() || !url.isValid())
        return;

    m_tabWidget->loadUrlInCurrentTab(url);
}

void BrowserMainWindow::slotPreferences()
{
    SettingsDialog *s = new SettingsDialog(this);
    s->show();
}

void BrowserMainWindow::slotUpdateWindowTitle(const QString &title)
{
    if (title.isEmpty()) {
        setWindowTitle(tr("QtDomTerm"));
    } else {
        setWindowTitle(title);
    }
}

void BrowserMainWindow::slotAboutApplication()
{
    QMessageBox::about(this, tr("About"), tr(
        "Version %1"
        "<p>QtDomTerm is a terminal emulator based on DomTerm (%1) and QtWebEngine (%3). "
        "<p>Copyright %2 Per Bothner."
        "<p>The DomTerm home page is <a href=\"http://domterm.org/\">http://domterm.org/</a>.")
                       .arg(QCoreApplication::applicationVersion())
                       .arg(QTDOMTERM_YEAR)
                       .arg(qVersion()));
}

void BrowserMainWindow::slotFileNew()
{
    BrowserApplication::instance()->newMainWindow(tabWidget()->currentWebView()->m_processOptions);
}

void BrowserMainWindow::slotFileOpen()
{
    QString file = QFileDialog::getOpenFileName(this, tr("Open Web Resource"), QString(),
            tr("Web Resources (*.html *.htm *.svg *.png *.gif *.svgz);;All files (*.*)"));

    if (file.isEmpty())
        return;

    loadPage(file);
}

void BrowserMainWindow::closeEvent(QCloseEvent *event)
{
    if (m_tabWidget->count() > 1) {
        int ret = QMessageBox::warning(this, QString(),
                           tr("Are you sure you want to close the window?"
                              "  There are %1 tabs open").arg(m_tabWidget->count()),
                           QMessageBox::Yes | QMessageBox::No,
                           QMessageBox::No);
        if (ret == QMessageBox::No) {
            event->ignore();
            return;
        }
    }
    event->accept();
    deleteLater();
}

void BrowserMainWindow::slotEditFind()
{
    if (!currentTab())
        return;
    bool ok;
    QString search = QInputDialog::getText(this, tr("Find"),
                                          tr("Text:"), QLineEdit::Normal,
                                          m_lastSearch, &ok);
    if (ok && !search.isEmpty()) {
        m_lastSearch = search;
        currentTab()->findText(m_lastSearch, 0, invoke(this, &BrowserMainWindow::handleFindTextResult));
    }
}

void BrowserMainWindow::slotEditFindNext()
{
    if (!currentTab() && !m_lastSearch.isEmpty())
        return;
    currentTab()->findText(m_lastSearch);
}

void BrowserMainWindow::slotEditFindPrevious()
{
    if (!currentTab() && !m_lastSearch.isEmpty())
        return;
    currentTab()->findText(m_lastSearch, QWebEnginePage::FindBackward);
}

void BrowserMainWindow::slotViewZoomIn()
{
    if (!currentTab())
        return;
    currentTab()->setZoomFactor(currentTab()->zoomFactor() + 0.1);
}

void BrowserMainWindow::slotViewZoomOut()
{
    if (!currentTab())
        return;
    currentTab()->setZoomFactor(currentTab()->zoomFactor() - 0.1);
}

void BrowserMainWindow::slotViewResetZoom()
{
    if (!currentTab())
        return;
    currentTab()->setZoomFactor(1.0);
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

void BrowserMainWindow::slotSwapFocus()
{
  /*
    if (currentTab()->hasFocus())
        m_tabWidget->currentLineEdit()->setFocus();
    else
        currentTab()->setFocus();
  */
}

void BrowserMainWindow::loadPage(const QString &page)
{
    QUrl url = QUrl::fromUserInput(page);
    loadUrl(url);
}

TabWidget *BrowserMainWindow::tabWidget() const
{
    return m_tabWidget;
}

WebView *BrowserMainWindow::currentTab() const
{
    return m_tabWidget->currentWebView();
}

void BrowserMainWindow::slotAboutToShowWindowMenu()
{
    m_windowMenu->clear();
    m_windowMenu->addAction(m_tabWidget->nextTabAction());
    m_windowMenu->addAction(m_tabWidget->previousTabAction());
    m_windowMenu->addSeparator();

    QList<BrowserMainWindow*> windows = BrowserApplication::instance()->mainWindows();
    for (int i = 0; i < windows.count(); ++i) {
        BrowserMainWindow *window = windows.at(i);
        QAction *action = m_windowMenu->addAction(window->windowTitle(), this, SLOT(slotShowWindow()));
        action->setData(i);
        action->setCheckable(true);
        if (window == this)
            action->setChecked(true);
    }
}

void BrowserMainWindow::slotShowWindow()
{
    if (QAction *action = qobject_cast<QAction*>(sender())) {
        QVariant v = action->data();
        if (v.canConvert<int>()) {
            int offset = qvariant_cast<int>(v);
            QList<BrowserMainWindow*> windows = BrowserApplication::instance()->mainWindows();
            windows.at(offset)->activateWindow();
            windows.at(offset)->currentTab()->setFocus();
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
