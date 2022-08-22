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
#include <QtWidgets/QMessageBox>
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

BrowserMainWindow::BrowserMainWindow(BrowserApplication* application,
                                     const QString& url, QSharedDataPointer<ProcessOptions> processOptions, QWidget *parent,
                                     Qt::WindowFlags wflags
    )
#if USE_KDDockWidgets
    : KDDockWidgets::MainWindow(BrowserApplication::uniqueNameFromUrl(url), KDDockWidgets::MainWindowOption_None, parent)
#else
    : QMainWindow(parent, wflags)
#endif
    , m_application(application)
#if USE_KDDockWidgets
    , m_webView(new WebView(processOptions, nullptr))
#else
    , m_webView(new WebView(processOptions, this))
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
#if defined(Q_OS_OSX)
        true
#else
        (wflags & Qt::FramelessWindowHint) == 0
#endif
        );
    if (usingQtMenus())
        setupMenu();
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

void BrowserMainWindow::setupMenu()
{
    new QShortcut(QKeySequence(Qt::Key_F6), this, SLOT(slotSwapFocus()));
    //connect(menuBar()->toggleViewAction(), SIGNAL(toggled(bool)),
    //            this, SLOT(updateMenubarActionText(bool)));

    // File
    QMenu *fileMenu = menuBar()->addMenu(tr("&File"));

    QAction*newTerminalWindow =
        fileMenu->addAction(tr("&New Window"), this,
                            &BrowserMainWindow::slotFileNew,
                            QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_N));
    newTerminalTab = fileMenu->addAction("New terminal tab",
                                         this, &BrowserMainWindow::slotNewTerminalTab, QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_T));
    fileMenu->addAction(newTerminalTab);
#if 0
    fileMenu->addSeparator();
    fileMenu->addAction(m_tabWidget->closeTabAction());
    fileMenu->addSeparator();
#endif
    fileMenu->addAction(webView()->saveAsAction());
    fileMenu->addSeparator();

#if defined(Q_OS_OSX)
    fileMenu->addAction(tr("&Quit"), BrowserApplication::instance(), SLOT(quitBrowser()), QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Q));
#else
    fileMenu->addAction(tr("&Quit"), this, SLOT(close()), QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Q));
#endif

    // Edit
    QMenu *editMenu = menuBar()->addMenu(tr("&Edit"));
    m_copy = editMenu->addAction(tr("&Copy"),
                                 this, &BrowserMainWindow::slotCopy);
    m_copy->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_C));
    editMenu->addAction(tr("Copy as HTML"), this,
                            &BrowserMainWindow::slotCopyAsHTML);
    m_paste = editMenu->addAction(tr("&Paste"),
                                  this, &BrowserMainWindow::slotPaste);
    m_paste->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_V));
    editMenu->addAction(tr("Clear Buffer"),
                        this, &BrowserMainWindow::slotClearBuffer);
    editMenu->addSeparator();

    QAction *m_find = editMenu->addAction(tr("&Find"), this,
                                          &BrowserMainWindow::slotEditFind);
    m_find->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_F));

    // View
    QMenu *viewMenu = menuBar()->addMenu(tr("&View"));

    m_viewMenubar = new QAction(this);
    updateMenubarActionText(true);
    connect(m_viewMenubar, SIGNAL(triggered()), this, SLOT(slotViewMenubar()));
    viewMenu->addAction(m_viewMenubar);

    viewMenu->addAction(tr("Zoom &In"), this, SLOT(slotViewZoomIn()), QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_Plus));
    viewMenu->addAction(tr("Zoom &Out"), this, SLOT(slotViewZoomOut()), QKeySequence(Qt::CTRL | Qt::Key_Minus));
    viewMenu->addAction(tr("Reset &Zoom"), this, SLOT(slotViewResetZoom()), QKeySequence(Qt::CTRL | Qt::Key_0));

    QAction *a = viewMenu->addAction(tr("&Full Screen"), this, SLOT(slotViewFullScreen(bool)),  Qt::Key_F11);
    a->setCheckable(true);

#if 1
    //QMenu *toolsMenu = menuBar()->addMenu(tr("&Tools"));
#if defined(QWEBENGINEINSPECTOR)
    a = viewMenu->addAction(tr("Enable Web &Inspector"), this, SLOT(slotToggleInspector(bool)));
    a->setCheckable(true);
#endif
#endif

    newTerminalMenu = new QMenu(tr("New Terminal"), this);
    newTerminalMenu->addAction(newTerminalWindow);
    newTerminalMenu->addAction(newTerminalTab);
    newTerminalPane = newTerminalMenu->addAction("New terminal (right/below)",
                                                 this, &BrowserMainWindow::slotNewTerminalPane);
    newTerminalAbove = newTerminalMenu->addAction("New terminal above",
                                                  this, &BrowserMainWindow::slotNewTerminalAbove);
    newTerminalBelow = newTerminalMenu->addAction("New terminal below",
                                                  this, &BrowserMainWindow::slotNewTerminalBelow);
    newTerminalLeft = newTerminalMenu->addAction("New terminal left",
                                                 this, &BrowserMainWindow::slotNewTerminalLeft);
    newTerminalRight = newTerminalMenu->addAction("New terminal right",
                                                  this, &BrowserMainWindow::slotNewTerminalRight);

    inputModeGroup = new QActionGroup(this);
    inputModeGroup->setExclusive(true);
    charInputMode = new QAction(tr("&Char mode"), inputModeGroup);
    lineInputMode = new QAction(tr("&Line mode"), inputModeGroup);
    autoInputMode = new QAction(tr("&Auto mode"), inputModeGroup);
    inputModeGroup->addAction(charInputMode);
    inputModeGroup->addAction(lineInputMode);
    inputModeGroup->addAction(autoInputMode);
    inputModeMenu = new QMenu(tr("&Input mode"), this);
    int nmodes = 3;
    for (int i = 0; i < nmodes; i++) {
        QAction *action = inputModeGroup->actions().at(i);
        action->setCheckable(true);
        inputModeMenu->addAction(action);
    }
    autoInputMode->setChecked(true);
    selectedInputMode = autoInputMode;
    connect(inputModeGroup, &QActionGroup::triggered,
            this, &BrowserMainWindow::changeInputMode);

    QMenu *terminalMenu = menuBar()->addMenu(tr("&Terminal"));
    terminalMenu->addMenu(inputModeMenu);
    togglePagingAction = terminalMenu->addAction("Automatic &Pager", this,
                                           &BrowserMainWindow::slotAutoPager);
    togglePagingAction->setCheckable(true);
    //terminalMenu->addAction(webView()->changeCaretAction());
    terminalMenu->addMenu(newTerminalMenu);
    detachAction = terminalMenu->addAction("&Detach", this,
                                           &BrowserMainWindow::slotDetach);

    QMenu *helpMenu = menuBar()->addMenu(tr("&Help"));
    helpMenu->addAction(tr("About QtDomTerm"), this, SLOT(slotAboutApplication()));
    helpMenu->addAction(tr("DomTerm home page"), this,
                        &BrowserMainWindow::slotOpenHomePage);
}

void BrowserMainWindow::changeInputMode(QAction* action)
{
    QActionGroup *inputMode = static_cast<QActionGroup *>(sender());
    if(!inputMode)
        qFatal("scrollPosition is NULL");
    if (action != selectedInputMode) {
        char mode = action == charInputMode ? 'c'
          : action == lineInputMode ? 'l'
          : 'a';
        inputModeChanged(mode);
        webView()->backend()->setInputMode(mode);
    }
}

void BrowserMainWindow::inputModeChanged(char mode)
{
    if (! usingQtMenus())
        return;
  QAction* action = mode == 'a' ? autoInputMode
    : mode == 'l' ? lineInputMode
    : charInputMode;
#if 0
    QActionGroup *inputMode = static_cast<QActionGroup *>(sender());
    if(!inputMode)
        qFatal("scrollPosition is NULL");
#endif
    if (action != selectedInputMode) {
        selectedInputMode->setChecked(false);
        action->setChecked(true);
        selectedInputMode = action;
    }
}
void BrowserMainWindow::autoPagerChanged(bool mode)
{
    autoInputMode->setChecked(mode);
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

void BrowserMainWindow::updateMenubarActionText(bool visible)
{
    m_viewMenubar->setText(!visible ? tr("Show Menubar") : tr("Hide Menubar"));
}

void BrowserMainWindow::loadUrl(const QUrl &url)
{
    if (!currentTab() || !url.isValid())
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

void  BrowserMainWindow::slotNewTerminal(int paneOp)
{
    emit webView()->backend()->layoutAddPane(paneOp);
}

void BrowserMainWindow::slotDetach()
{
    emit webView()->backend()->handleSimpleCommand("detach-session");
}

void BrowserMainWindow::slotAutoPager()
{
    emit webView()->backend()->handleSimpleCommand("toggle-auto-pager");
}

void BrowserMainWindow::slotClearBuffer()
{
    emit webView()->backend()->handleSimpleCommand("clear-buffer");
}

void BrowserMainWindow::slotCopy()
{
    emit webView()->backend()->handleSimpleCommand("copy-text");
}

void BrowserMainWindow::slotPaste()
{
    emit webView()->backend()->handleSimpleCommand("paste-text");
}

void BrowserMainWindow::slotCopyAsHTML()
{
    emit webView()->backend()->handleSimpleCommand("copy-html");
}

void BrowserMainWindow::slotOpenHomePage()
{
    QDesktopServices::openUrl(QUrl("https://domterm.org/"));
}

void BrowserMainWindow::slotAboutApplication()
{
    QMessageBox::about(this, tr("About"), tr(
        "Version %1"
        "<p>QtDomTerm is a terminal emulator based on DomTerm (%1) and QtWebEngine (%3). "
        "<p>Copyright %2 Per Bothner."
        "<p>The DomTerm home page is <a href=\"https://domterm.org/\">https://domterm.org/</a>.")
                       .arg(QCoreApplication::applicationVersion())
                       .arg(QTDOMTERM_YEAR)
                       .arg(qVersion()));
}

void BrowserMainWindow::slotFileNew()
{
    // Calling newMainWindow directly is more efficient, but
    // using handleSimpleCommand makes it easier to do things consistently.
#if 1
    emit webView()->backend()->handleSimpleCommand("new-window");
#else
    QSharedDataPointer<ProcessOptions> options = webView()->m_processOptions;
    QUrl url = options->url;
    if (url.hasFragment()) {
        QUrlQuery fragment = QUrlQuery(url.fragment().replace(";", "&"));
        fragment.removeQueryItem("session-number");
        fragment.removeQueryItem("window");
        url.setFragment(fragment.isEmpty() ? QString()
                        : fragment.toString());
    }
    BrowserApplication::instance()->newMainWindow(url.toString(), options);
#endif
}

void BrowserMainWindow::closeEvent(QCloseEvent *event)
{
    event->accept();
    deleteLater();
}

void BrowserMainWindow::slotEditFind()
{
    emit webView()->backend()->handleSimpleCommand("find-text");
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

WebView *BrowserMainWindow::currentTab() const
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
