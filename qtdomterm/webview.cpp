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
#include "savepagedialog.h"
#include "backend.h"

#include <QtGui/QClipboard>
#include <QtNetwork/QNetworkReply>
#include <QtWidgets/QMenu>
#include <QtWidgets/QMessageBox>
#include <QtWidgets/QVBoxLayout>
#include <QtGui/QMouseEvent>
#include <QWebChannel>
#include <QWebEngineProfile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>

//#include <QWebEngineContextMenuData>

#ifndef QT_NO_UITOOLS
#include <QtUiTools/QUiLoader>
#endif  //QT_NO_UITOOLS

#include <QTextStream>
#include <QIODevice>
#include <QtCore/QDebug>
#include <QtCore/QBuffer>
#include <QtCore/QTimer>

WebPage::WebPage(QWebEngineProfile *profile, QObject *parent)
    : QWebEnginePage(profile, parent)
    , m_keyboardModifiers(Qt::NoModifier)
    , m_pressedButtons(Qt::NoButton)
{
#if defined(QWEBENGINEPAGE_SETNETWORKACCESSMANAGER)
    setNetworkAccessManager(BrowserApplication::networkAccessManager());
#endif
#if defined(QWEBENGINEPAGE_UNSUPPORTEDCONTENT)
    connect(this, SIGNAL(unsupportedContent(QNetworkReply*)),
            this, SLOT(handleUnsupportedContent(QNetworkReply*)));
#endif
}

BrowserMainWindow *WebView::mainWindow()
{
    return BrowserMainWindow::containingMainWindow(this);
}

BrowserApplication *WebView::application()
{
    return mainWindow()->application();
}

void WebView::newPage(const QString& url)
{
    setPage(new WebPage(QWebEngineProfile::defaultProfile(), this));

    //setupPage(newWebView->page());
    //fprintf(stderr, "WebView::newPage url:%s\n", url.toUtf8().constData());
    this->setUrl(url);
}

#if USE_KDDockWidgets
void
WebView::setDockWidget(KDDockWidgets::DockWidget *dock)
{
    dock->setWidget(this);
    this->m_dockWidget = dock;
}
#endif

#if USE_KDDockWidgets || USE_DOCK_MANAGER
DockWidget *
WebView::dockWidget()
{
    if (! m_dockWidget) {
        //auto dock = new DockWidget(BrowserApplication::uniqueNameFromUrl(url));
        auto dock = new DockWidget("DT-x");
        dock->setWidget(this);
        this->m_dockWidget = dock;
    }
    return m_dockWidget;
}
DockWidget *
WebView::setDockWidget(const QString &uniqueName)
{
    auto dock = new DockWidget(uniqueName);
    dock->setWidget(this);
    this->m_dockWidget = dock;
    return dock;
}
#endif

#if 0
class PopupWindow : public QWidget {
    Q_OBJECT
public:
    PopupWindow(QSharedDataPointer<ProcessOptions> processOptions, QWebEngineProfile *profile)
        : m_view(new WebView(processOptions, -1, this))
    {
        m_view->setPage(new WebPage(profile, m_view));
        QVBoxLayout *layout = new QVBoxLayout;
        layout->setMargin(0);
        setLayout(layout);
        layout->addWidget(m_view);
        m_view->setFocus();

        connect(m_view, &WebView::titleChanged, this, &QWidget::setWindowTitle);
        connect(page(), &WebPage::geometryChangeRequested, this, &PopupWindow::adjustGeometry);
        connect(page(), &WebPage::windowCloseRequested, this, &QWidget::close);
    }

    QWebEnginePage* page() const { return m_view->page(); }

private Q_SLOTS:
    void setUrl(const QUrl &/*url*/)
    {
    }

    void adjustGeometry(const QRect &/*newGeometry*/)
    {
    }

private:
    WebView *m_view;

};
#endif

#if defined(QWEBENGINEPAGE_UNSUPPORTEDCONTENT)
void WebPage::handleUnsupportedContent(QNetworkReply *reply)
{
    QString errorString = reply->errorString();

    if (m_loadingUrl != reply->url()) {
        // sub resource of this page
        qWarning() << "Resource" << reply->url().toEncoded() << "has unknown Content-Type, will be ignored.";
        reply->deleteLater();
        return;
    }

    if (reply->error() == QNetworkReply::NoError && !reply->header(QNetworkRequest::ContentTypeHeader).isValid()) {
        errorString = "Unknown Content-Type";
    }

    QFile file(QLatin1String(":/notfound.html"));
    bool isOpened = file.open(QIODevice::ReadOnly);
    Q_ASSERT(isOpened);
    Q_UNUSED(isOpened)

    QString title = tr("Error loading page: %1").arg(reply->url().toString());
    QString html = QString(QLatin1String(file.readAll()))
                        .arg(title)
                        .arg(errorString)
                        .arg(reply->url().toString());

    QBuffer imageBuffer;
    imageBuffer.open(QBuffer::ReadWrite);
    QIcon icon = view()->style()->standardIcon(QStyle::SP_MessageBoxWarning, 0, view());
    QPixmap pixmap = icon.pixmap(QSize(32,32));
    if (pixmap.save(&imageBuffer, "PNG")) {
        html.replace(QLatin1String("IMAGE_BINARY_DATA_HERE"),
                     QString(QLatin1String(imageBuffer.buffer().toBase64())));
    }

    QList<QWebEngineFrame*> frames;
    frames.append(mainFrame());
    while (!frames.isEmpty()) {
        QWebEngineFrame *frame = frames.takeFirst();
        if (frame->url() == reply->url()) {
            frame->setHtml(html, reply->url());
            return;
        }
        QList<QWebEngineFrame *> children = frame->childFrames();
        foreach (QWebEngineFrame *frame, children)
            frames.append(frame);
    }
    if (m_loadingUrl == reply->url()) {
        mainFrame()->setHtml(html, reply->url());
    }
}
#endif

WebView::WebView(QSharedDataPointer<ProcessOptions> processOptions,
                 int windowNumber, QWidget* parent)
    : QWebEngineView(parent)
    , m_processOptions(processOptions)
      //, _context_menu_pending(0)
    , m_windowNumber(windowNumber)
    , m_progress(0)
    , m_page(0)
    , m_blockCaret(true)
{
    connect(this, SIGNAL(loadProgress(int)),
            this, SLOT(setProgress(int)));
    connect(this, SIGNAL(loadFinished(bool)),
            this, SLOT(loadFinished(bool)));
    connect(this, &QWebEngineView::renderProcessTerminated,
            [=](QWebEnginePage::RenderProcessTerminationStatus termStatus, int statusCode) {
        const char *status = "";
        switch (termStatus) {
        case QWebEnginePage::NormalTerminationStatus:
            status = "(normal exit)";
            break;
        case QWebEnginePage::AbnormalTerminationStatus:
            status = "(abnormal exit)";
            break;
        case QWebEnginePage::CrashedTerminationStatus:
            status = "(crashed)";
            break;
        case QWebEnginePage::KilledTerminationStatus:
            status = "(killed)";
            break;
        }

        qInfo() << "Render process exited with code" << statusCode << status;
    });

    m_changeCaretAction = new QAction(tr("Block caret (char mode only)"), this);
    m_changeCaretAction->setCheckable(true);
    connect(m_changeCaretAction, SIGNAL(triggered(bool)), this, SLOT(requestChangeCaret(bool)));
    m_openAction = new QAction(tr("Open Link"), this);
    connect(m_openAction, &QAction::triggered,
	    this,  &WebView::slotOpenLink);
    m_copyLinkAddress = new QAction(tr("Copy Link Address"), this);
    connect(m_copyLinkAddress, &QAction::triggered,
	    this, &WebView::slotCopyLinkAddress);
    m_copyInContext = new QAction(tr("&Copy"), this);
    m_copyInContext->setShortcut(QKeySequence(Qt::CTRL|Qt::SHIFT|Qt::Key_C));
    connect(m_copyInContext, &QAction::triggered,
	    this, &WebView::slotCopyInContext);
}

void WebView::setPage(WebPage *_page)
{
    if (m_page)
        m_page->deleteLater();
    m_page = _page;
    QWebEngineView::setPage(_page);
#if defined(QWEBENGINEPAGE_UNSUPPORTEDCONTENT)
    page()->setForwardUnsupportedContent(true);
#endif
    QWebChannel *channel = new QWebChannel(this);
    m_backend = new Backend(m_processOptions, this);
    channel->registerObject(QStringLiteral("backend"), m_backend);
    page()->setWebChannel(channel);
}

void WebView::setPaneZoom(qreal zoom)
{
    this->paneZoom = zoom;
    setZoomFactor(zoom * mainWindow()->mainZoom());
}

void WebView::setSetting(const QString& key, const QString& value)
{
    if (key=="style.qt") {
        setStyleSheet(value);
    }
}

QString WebView::generateSaveFileName() // FIXME
{
    //return backend->sessionName() + ".html";
    char buf[100];
    sprintf(buf, "domterm-saved-%d.html", mainWindow()->application()->getSaveFileCount());
    return QString(buf);
}

void WebView::requestChangeCaret(bool set)
{
    m_backend->requestChangeCaret(set);
    this->setBlockCaret(set);
}

void WebView::showContextMenu(const QString& contextMenuAsJson)
{
    auto *window = mainWindow();
    window->contextMenuAsJson = contextMenuAsJson;
    // Unfortunately, when using an iframe, the call to showContextMenu
    // arrives *after* the native contextMenuEvent handler.
    // We could delay calling displayContextMenu to here,
    // I can't get contextMenuPosition set properly.
    // displayContextMenu(contextTypeForMenu);
    auto now = std::chrono::steady_clock::now();
    if (window->_context_menu_pending == 2
        && std::chrono::duration<double>(window->_context_menu_time - now).count() < 0.05) {
        displayContextMenu(window->contextMenuAsJson);
        window->_context_menu_pending = 0;
    } else {
        window->_context_menu_time = now;
        window->_context_menu_pending = 1;
    }
}

void WebView::contextMenuEvent(QContextMenuEvent *event)
{
    auto *window = mainWindow();
    if (window->usingQtMenus()) {
        window->contextMenuPosition = event->globalPos();
        // Ideally, this should be done in showContextMenu.
        //displayContextMenuT(contextTypeForMenu);
        auto now = std::chrono::steady_clock::now();
        if (window->_context_menu_pending == 1
            && std::chrono::duration<double>(window->_context_menu_time - now).count() < 0.05) {
            displayContextMenu(window->contextMenuAsJson);
            window->_context_menu_pending = 0;
        } else {
            window->_context_menu_time = now;
            window->_context_menu_pending = 2;
        }
    }
}

static void jsonToMenu(const QJsonArray& jarray, QMenu *menu, QActionGroup *group, BrowserApplication *app)
{
    QObject *parent;
    if (group != nullptr)
        parent = group;
    else
        parent = menu;
    for (auto item : jarray) {
        if (item.isObject()) {
            QJsonObject mitem = item.toObject();
            auto jlabel = mitem.value("label");
            auto jclick = mitem.value("clickClientAction");
            auto jsubmenu = mitem.value("submenu");
            auto jchecked = mitem.value("checked");
            auto jvisible = mitem.value("visible");
            auto jtype = mitem.value("type");
            QString type = jtype.isString() ? jtype.toString() : "normal";
            auto jaccelerator = mitem.value("accelerator");
            QAction *action = nullptr;
            if (jvisible.isBool() && ! jvisible.toBool()) {
            } else if (type == "separator") {
                menu->addSeparator();
            } else if (jlabel.isString() && jsubmenu.isArray()) {
                QMenu *smenu = menu->addMenu(jlabel.toString());
                QActionGroup *group = nullptr;
                if (type == "radio") {
                    group = new QActionGroup(parent);
                    group->setExclusive(true);
                }
                jsonToMenu(jsubmenu.toArray(), smenu, group, app);
            } else if (jlabel.isString() && jclick.isString()) {
                action = new NamedAction(jlabel.toString(), app, parent, jclick.toString().toStdString().c_str());
                if (group) {
                    group->addAction(action);
                    action->setCheckable(true);
                }
                if (jaccelerator.isArray()) {
                    auto acc = jaccelerator.toArray();
                    if (acc.size() == 2)
                        action->setShortcut(QKeySequence::fromString(acc[0].toString() + "," + acc[1].toString()));
                }
                if (jaccelerator.isString()) {
                    QString acc = jaccelerator.toString();
                    action->setShortcut(QKeySequence::fromString(acc));
                }
                if (type == "checkbox")
                    action->setCheckable(true);
                if (jchecked.isBool()) {
                    action->setChecked(jchecked.toBool());
                }
            }
            if (action != nullptr) {
                menu->addAction(action);
            }
        }
    }
}

void WebView::displayContextMenu(const QString& menuAsJson)
{
    auto *window = mainWindow();
    QMenu *menu = window->_context_menu;
    if (menu == nullptr) {
        menu = new QMenu(this);
        window->_context_menu = menu;
    } else {
        menu->clear();
    }
    BrowserApplication *app = application();
    QJsonDocument menuDocument = QJsonDocument::fromJson(menuAsJson.toUtf8());
    jsonToMenu(menuDocument.array(), menu, nullptr, app);
    menu->popup(window->contextMenuPosition);
}

void WebView::slotOpenLink()
{
    emit backend()->handleSimpleCommand("open-link");
}

void WebView::slotCopyLinkAddress()
{
    emit backend()->handleSimpleCommand("copy-link-address");
}
void WebView::slotCopyInContext()
{
    emit backend()->handleSimpleCommand("copy-in-context");
}

void WebView::wheelEvent(QWheelEvent *event)
{
#if defined(QWEBENGINEPAGE_SETTEXTSIZEMULTIPLIER)
    if (QApplication::keyboardModifiers() & Qt::ControlModifier) {
        int numDegrees = event->delta() / 8;
        int numSteps = numDegrees / 15;
        setTextSizeMultiplier(textSizeMultiplier() + numSteps * 0.1);
        event->accept();
        return;
    }
#endif
    QWebEngineView::wheelEvent(event);
}

void WebView::setProgress(int progress)
{
    m_progress = progress;
}

void WebView::loadFinished(bool success)
{
    if (success && 100 != m_progress) {
        qWarning() << "Received finished signal while progress is still:" << progress()
                   << "Url:" << url();
    }
    m_progress = 0;
}

void WebView::loadUrl(const QUrl &url)
{
    m_initialUrl = url;
    load(url);
}

QUrl WebView::url() const
{
    QUrl url = QWebEngineView::url();
    if (!url.isEmpty())
        return url;

    return m_initialUrl;
}

void WebView::onIconChanged(const QIcon &/*icon*/)
{
}

void WebView::mousePressEvent(QMouseEvent *event)
{
    m_page->m_pressedButtons = event->buttons();
    m_page->m_keyboardModifiers = event->modifiers();
    // This method doesn't seem to be called,
    // so we can't use it to set contextMenuPosition.
#if QT_VERSION >= QT_VERSION_CHECK(6, 0, 0)
    mainWindow()->contextMenuPosition = event->globalPosition().toPoint();
#else
    mainWindow()->contextMenuPosition = event->globalPos();
#endif
    QWebEngineView::mousePressEvent(event);
}

void WebView::mouseReleaseEvent(QMouseEvent *event)
{
    QWebEngineView::mouseReleaseEvent(event);
    if (!event->isAccepted() && (m_page->m_pressedButtons & Qt::MiddleButton)) {
        QUrl url(QApplication::clipboard()->text(QClipboard::Selection));
        if (!url.isEmpty() && url.isValid() && !url.scheme().isEmpty()) {
            setUrl(url);
        }
    }
}
