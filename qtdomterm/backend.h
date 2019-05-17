/* This is derived from the Session class of qtermwidget.
 */


#ifndef BACKEND_H
#define BACKEND_H

#include <QObject>
#include <QString>
#include <QSharedDataPointer>

class ProcessOptions;
class WebView;

class Backend : public QObject
{
    Q_OBJECT
public:
    explicit Backend(QSharedDataPointer<ProcessOptions> processOptions,
                     QObject *parent = 0);
    ~Backend();
    void setInputMode(char mode);
    QString sessionName() { return _nameTitle; }
    void setSessionName(const QString& name);
    void requestHtmlData();
    void requestChangeCaret(bool);
    void loadSessionName();

    ProcessOptions* processOptions();
    WebView *webView() const { return (WebView*)parent(); }

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
    void handleSimpleMessage(const QString& msg); // deprecated?
    void handleSimpleCommand(const QString& msg);
    void writeInputMode(int mode);
    void writeSetCaretStyle(int style);
    void writeEncoded(int nbytes, const QString &encodedBytes);
    void writeOperatingSystemControl(int code, const QString& text);
public slots:
    void setWindowTitle(const QString& title);
    void setSavedHtml(const QString &info) { _savedHtml = info; }
    void closeMainWindow();
    void openNewWindow(int width, int height, const QString& url);
    void showContextMenu(const QString& contextType);
    void setSetting(const QString& key, const QString& value);
    void setClipboard(const QString& plain, const QString& html);
    void inputModeChanged(int mode);
    void autoPagerChanged(bool mode);
    void log(const QString& message);

    void close();

private slots:
    QString toJsonQuoted(QString str);
    void onReceiveBlock( const char * buffer, int len );
private:
    QSharedDataPointer<ProcessOptions> _processOptions;

    bool           _wantedClose;
    int            _sessionId;

    QString        _nameTitle;
    QString        _displayTitle;

    QString        _domtermVersion;
    QString        _savedHtml;
};

#endif
