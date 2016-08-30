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
#include "tabwidget.h"
#include "webview.h"
#include "backend.h"

#include <QtGui/QClipboard>
#include <QtNetwork/QNetworkReply>
#include <QtWidgets/QMenu>
#include <QtWidgets/QMessageBox>
#include <QtWidgets/QVBoxLayout>
#include <QtGui/QMouseEvent>
#include <QWebChannel>

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

BrowserMainWindow *WebPage::mainWindow()
{
    QObject *w = this->parent();
    while (w) {
        if (BrowserMainWindow *mw = qobject_cast<BrowserMainWindow*>(w))
            return mw;
        w = w->parent();
    }
    return BrowserApplication::instance()->mainWindow();
}

bool WebPage::certificateError(const QWebEngineCertificateError &error)
{
    if (error.isOverridable()) {
        QMessageBox msgBox;
        msgBox.setIcon(QMessageBox::Warning);
        msgBox.setText(error.errorDescription());
        msgBox.setInformativeText(tr("If you wish so, you may continue with an unverified certificate. "
                                     "Accepting an unverified certificate means "
                                     "you may not be connected with the host you tried to connect to.\n"
                                     "Do you wish to override the security check and continue?"));
        msgBox.setStandardButtons(QMessageBox::Yes | QMessageBox::No);
        msgBox.setDefaultButton(QMessageBox::No);
        return msgBox.exec() == QMessageBox::Yes;
    }
    QMessageBox::critical(view(), tr("Certificate Error"), error.errorDescription(), QMessageBox::Ok, QMessageBox::NoButton);
    return false;
}

#if 0
class PopupWindow : public QWidget {
    Q_OBJECT
public:
    PopupWindow(QSharedDataPointer<ProcessOptions> processOptions, QWebEngineProfile *profile)
      : m_view(new WebView(processOptions, this))
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

#include "webview.moc"

#if !defined(QT_NO_UITOOLS)
QObject *WebPage::createPlugin(const QString &classId, const QUrl &url, const QStringList &paramNames, const QStringList &paramValues)
{
    Q_UNUSED(url);
    Q_UNUSED(paramNames);
    Q_UNUSED(paramValues);
    QUiLoader loader;
    return loader.createWidget(classId, view());
}
#endif // !defined(QT_NO_UITOOLS)

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
                 QWidget* parent)
    : QWebEngineView(parent)
    , m_processOptions(processOptions)
    , m_progress(0)
    , m_page(0)
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
            this, &WebView::changeInputMode);
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
    BrowserApplication * app = BrowserApplication::instance();
    if (! m_processOptions->should_connect()) {
        QWebChannel *channel = new QWebChannel(this);
        m_backend = new Backend(m_processOptions, this);
        connect(m_backend, SIGNAL(finished()), this, SIGNAL(finished()));
        channel->registerObject(QStringLiteral("backend"), m_backend);
        page()->setWebChannel(channel);
        m_backend->setSessionName(app->generateSessionName());
    }
}

void WebView::changeInputMode(QAction* action)
{
    QActionGroup *inputMode = static_cast<QActionGroup *>(sender());
    if(!inputMode)
        qFatal("scrollPosition is NULL");
    if (action != selectedInputMode) {
        selectedInputMode->setChecked(false);
        action->setChecked(true);
        selectedInputMode = action;
        char mode = action == charInputMode ? 'c'
          : action == lineInputMode ? 'l'
          : 'a';
        backend()->setInputMode(mode);
    }
}

void WebView::contextMenuEvent(QContextMenuEvent *event)
{
    QMenu *menu;
    // if (page()->contextMenuData().linkUrl().isValid()) {
    if (1) {
        menu = new QMenu(this);
        /*
        QAction *m_copy = menu->addAction(tr("&Copy"));
        m_copy->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_C));
        this->addAction(m_copy, QWebEnginePage::Copy);
        QAction *m_paste = menu->addAction(tr("&Paste"));
        m_paste->setShortcut(QKeySequence(Qt::CTRL | Qt::SHIFT | Qt::Key_V));
        this->addAction(m_paste, QWebEnginePage::Paste);
        */
        // This doesn't show the shutcut keys - but they work.
        menu->addAction(page()->action(QWebEnginePage::Paste));
        menu->addAction(page()->action(QWebEnginePage::Copy));

        menu->addAction(webPage()->mainWindow()->m_viewMenubar);

        menu->addMenu(inputModeMenu);
    } else {
        menu = page()->createStandardContextMenu();
    }
    //if (page()->contextMenuData().selectedText().isEmpty())
    //menu->addAction(page()->action(QWebEnginePage::SavePage));
    connect(menu, &QMenu::aboutToHide, menu, &QObject::deleteLater);
    menu->popup(event->globalPos());
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
    QWebEngineView::mousePressEvent(event);
}

void WebView::mouseReleaseEvent(QMouseEvent *event)
{
    QWebEngineView::mouseReleaseEvent(event);
    if (!event->isAccepted() && (m_page->m_pressedButtons & Qt::MidButton)) {
        QUrl url(QApplication::clipboard()->text(QClipboard::Selection));
        if (!url.isEmpty() && url.isValid() && !url.scheme().isEmpty()) {
            setUrl(url);
        }
    }
}
