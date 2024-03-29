/* This is derived from the Session class of qtermwidget.
 */


#ifndef BACKEND_H
#define BACKEND_H

#include <QObject>
#include <QString>
#include <QSharedDataPointer>

class ProcessOptions;
class BrowserMainWindow;
class WebView;

class Backend : public QObject
{
    Q_OBJECT
public:
    explicit Backend(QSharedDataPointer<ProcessOptions> processOptions,
                     QObject *parent = 0);
    ~Backend();

    ProcessOptions* processOptions();
    WebView *webView() const { return (WebView*)parent(); }
    BrowserMainWindow *mainWindow() const;
    int windowNumber() const;

    QString domtermVersion() { return _domtermVersion; }
    void addDomtermVersion(const QString &info);
    QString getSavedHtml() { return _savedHtml; }

signals:
    /** Emitted when the terminal process starts. */
    void started();

    /**
     * Emitted when the terminal process exits.
     */
    void finished();
    void logToBrowserConsole(const QString& text);
    void handleSimpleCommand(const QString& msg);
    void writeEncoded(int nbytes, const QString &encodedBytes);
    void writeOperatingSystemControl(int code, const QString& text);
    void reportEventToServer(const QString& name, const QString& data);
    void forwardToParentWindow(int windowNumber, const QString& command, const QString& args_json);
    void forwardToChildWindow(const QString& command, const QString& args_json);

public slots:
    void saveFile(const QString& html);
    void showMenubar(bool show);
    void setWindowTitle(const QString& title);
    void setSavedHtml(const QString &info) { _savedHtml = info; }
    void windowOp(const QString& opname);
    void openNewWindow(const QString& joptions);
#if USE_KDDockWidgets || USE_DOCK_MANAGER
    void newPane(int paneOp, const QString& url);
#else
    void newPane(int windowNumber, const QString& url);
#endif
    void adoptPane(int windowNumber);
    void setMainZoom(qreal zoom);
    void setPaneZoom(int windowNumber, qreal zoom);
    void setGeometry(int windowNumber, int x, int y, int width, int height);
    void moveMainWindow(int x, int y);
    void closePane(int windowNumber);
    void sendParentMessage(const QString& command, const QString& args_json);
    void sendChildMessage(int windowNumber, const QString& command, const QString& args_json);
    void lowerOrRaisePanes(bool raise, bool allWindows);
    void focusPane(int windowNumber);
    QWidget* paneFor(int windowNumber);
    void showPane(int windowNumber, bool visibility);

    void showContextMenu(const QString& contextMenuAsJson);
    void setSetting(const QString& key, const QString& value);
    void setClipboard(const QString& plain, const QString& html);
    void inputModeChanged(int mode);
    void autoPagerChanged(bool mode);
    void log(const QString& message);
    void startSystemMove();
    void startSystemResize(const QString& edges);
    QString popupMessage(const QString&optionsAsJson);

    void close();

private slots:
    QString toJsonQuoted(QString str);
private:
    QSharedDataPointer<ProcessOptions> _processOptions;
    bool           _wantedClose;
    int            _sessionId;

    QString        _displayTitle;

    QString        _domtermVersion;
    QString        _savedHtml;
};

#endif
