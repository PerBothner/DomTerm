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
    /**
     * Return the session title set by the user (ie. the program running
     * in the terminal), or an empty string if the user has not set a custom ti
tle
     */
    QString userTitle() const;

    QString domtermVersion() { return _domtermVersion; }
    void addDomtermVersion(const QString &info);
    QString getSavedHtml() { return _savedHtml; }
    //void handleSimpleMessage(QString msg);

signals:
    /** Emitted when the terminal process starts. */
    void started();

    /**
     * Emitted when the terminal process exits.
     */
    void finished();
    void layoutAddPane(int paneOp);
    void copyAsHTML();
    void detachSession();
    void handleSimpleMessage(const QString& msg);
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
    void log(const QString& message);

    void close();

    /**
     * Changes the session title or other customizable aspects of the terminal
     * emulation display. For a list of what may be changed see the
     * Emulation::titleChanged() signal.
     */
    void setUserTitle( int, const QString & caption );

private slots:
    QString parseSimpleJsonString(QString str, int start, int end);
    QString toJsonQuoted(QString str);
    void onReceiveBlock( const char * buffer, int len );
private:
    QSharedDataPointer<ProcessOptions> _processOptions;

    bool           _wantedClose;
    int            _sessionId;

    QString        _nameTitle;
    QString        _displayTitle;
    QString        _userTitle;

    QString        _domtermVersion;
    QString        _savedHtml;
};

#endif
