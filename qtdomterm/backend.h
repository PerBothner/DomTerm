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
    void setInputMode(char mode);
    void paste();
    QString sessionName() { return _nameTitle; }
    void setSessionName(const QString& name);
    void requestHtmlData();
    void requestChangeCaret(bool);
    void loadSessionName();

    ProcessOptions* processOptions();
    WebView *webView() const { return (WebView*)parent(); }
    BrowserMainWindow *mainWindow() const;
    int windowNumber() const { return _windowNumber; }

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
    void layoutAddPane(int paneOp);
    void copyAsHTML();
    void logToBrowserConsole(const QString& text);
    void pasteText(const QString& text);
    void handleSimpleCommand(const QString& msg);
    void writeInputMode(int mode);
    void writeSetCaretStyle(int style);
    void writeEncoded(int nbytes, const QString &encodedBytes);
    void writeOperatingSystemControl(int code, const QString& text);
    void reportEventToServer(const QString& name, const QString& data);
    void forwardToParentWindow(int windowNumber, const QString& command, const QString& args_json);
    void forwardToChildWindow(const QString& command, const QString& args_json);

public slots:
    void saveFile(const QString& html);
    void setWindowTitle(const QString& title);
    void setSavedHtml(const QString &info) { _savedHtml = info; }
    void windowOp(const QString& opname);
    void openNewWindow(int width, int height, const QString& position,
                       const QString& url,
                       bool headless, const QString& titlebar);
#if USE_KDDockWidgets || USE_DOCK_MANAGER
    void newPane(int paneOp, const QString& url);
#else
    void newPane(int windowNumber, const QString& url);
#endif
    void adoptPane(int windowNumber);
    void setGeometry(int windowNumber, int x, int y, int width, int height);
    void closePane(int windowNumber);
    void sendParentMessage(const QString& command, const QString& args_json);
    void sendChildMessage(int windowNumber, const QString& command, const QString& args_json);
    void lowerOrRaisePanes(bool raise, bool allWindows);
    void focusPane(int windowNumber);
    void showPane(int windowNumber, bool visibility);
    void showContextMenu(const QString& contextType);
    void setSetting(const QString& key, const QString& value);
    void setClipboard(const QString& plain, const QString& html);
    void inputModeChanged(int mode);
    void autoPagerChanged(bool mode);
    void log(const QString& message);
    void startSystemMove();
    void startSystemResize(const QString& edges);

    void close();

private slots:
    QString toJsonQuoted(QString str);
private:
    QSharedDataPointer<ProcessOptions> _processOptions;
    int            _windowNumber;
    bool           _wantedClose;
    int            _sessionId;

    QString        _nameTitle;
    QString        _displayTitle;

    QString        _domtermVersion;
    QString        _savedHtml;
};

#endif
