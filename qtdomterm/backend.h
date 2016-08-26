/* This is derived from the Session class of qtermwidget.
 */


#ifndef BACKEND_H
#define BACKEND_H

#include <QObject>
#include <QString>
#include <QSharedDataPointer>

class KPtyDevice;
class ProcessOptions;
namespace Konsole {
    class Pty;
}

class Backend : public QObject
{
    Q_OBJECT
public:
    explicit Backend(QSharedDataPointer<ProcessOptions> processOptions,
                     QObject *parent = 0);
    ~Backend();
    void dowrite(const QString &text);
    void setInputMode(char mode);
    QString sessionName() { return _nameTitle; }
    void setSessionName(const QString& name);
    void requestHtmlData();
    void loadSessionName();
    void loadStylesheet(const QString& stylesheet, const QString& name);

    QString program() const;
    QStringList arguments() const;

    /** Returns the session's current working directory. */
    QString initialWorkingDirectory() const;

    ProcessOptions* processOptions();
    /**
     * Returns the environment of this session as a list of strings like
     * VARIABLE=VALUE
     */
    QStringList environment() const;

    /**
     * Return the session title set by the user (ie. the program running
     * in the terminal), or an empty string if the user has not set a custom ti
tle
     */
    QString userTitle() const;

    bool isCanonicalMode();
    bool isEchoingMode();

   /** Sends the specified @p signal to the terminal process. */
    bool sendSignal(int signal);

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

    /*!
        This signal is emitted from the C++ side and the text displayed on the HTML client side.
    */
    void write(const QString &text);
public slots:
    void processInputCharacters(const QString &text);
    void reportEvent(const QString &name, const QString &data);
    void setWindowSize(int nrows, int ncols, int pixw, int pixh);
    void reloadStylesheet();
    void log(const QString& message);

    /**
     * Starts the terminal session.
     *
     * This creates the terminal process and connects the teletype to it.
     */
    void run();

    /**
     * Closes the terminal session.  This sends a hangup signal
     * (SIGHUP) to the terminal process and causes the done(Session*)
     * signal to be emitted.
     */
    void close();

    /**
     * Changes the session title or other customizable aspects of the terminal
     * emulation display. For a list of what may be changed see the
     * Emulation::titleChanged() signal.
     */
    void setUserTitle( int, const QString & caption );

private slots:
    void done(int);
    QString parseSimpleJsonString(QString str, int start, int end);
    QString toJsonQuoted(QString str);
    void onReceiveBlock( const char * buffer, int len );
    KPtyDevice *pty() const;
private:
    QSharedDataPointer<ProcessOptions> _processOptions;
    Konsole::Pty     *_shellProcess;

    bool           _wantedClose;
    int            _sessionId;

    QString        _nameTitle;
    QString        _displayTitle;
    QString        _userTitle;

    QString        _domtermVersion;
    bool           _stylesheetLoaded;
    QString        _savedHtml;
};

#endif
