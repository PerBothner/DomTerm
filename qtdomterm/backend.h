/* This is derived from the Session class of qtermwidget.
 */


#ifndef BACKEND_H
#define BACKEND_H

#include <QObject>
#include <QString>

class KPtyDevice;
namespace Konsole {
    class Pty;
}

class Backend : public QObject
{
    Q_OBJECT
public:
    explicit Backend(QObject *parent = 0);
    ~Backend();
    void dowrite(const QString &text);

   /**
     * Sets the command line arguments which the session's program will be passe
d when
     * run() is called.
     */
    void setArguments(const QStringList & arguments);
    /** Sets the program to be executed when run() is called. */
    void setProgram(const QString & program);

    /** Returns the session's current working directory. */
    QString initialWorkingDirectory() {
        return _initialWorkingDir;
    }

    /**
     * Sets the initial working directory for the session when it is run
     * This has no effect once the session has been started.
     */
    void setInitialWorkingDirectory( const QString & dir );

    /**
     * Returns the environment of this session as a list of strings like
     * VARIABLE=VALUE
     */
    QStringList environment() const;

    /**
     * Sets the environment for this session.
     * @p environment should be a list of strings like
     * VARIABLE=VALUE
     */
    void setEnvironment(const QStringList & environment);

    void addEnvironment(const QString& var);

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

    /**
     * Specifies whether to close the session automatically when the terminal
     * process terminates.
     */
    void setAutoClose(bool b) {
        _autoClose = b;
    }

    QString domtermVersion() { return _domtermVersion; }
    void addDomtermVersion(const QString &info);

signals:
    /** Emitted when the terminal process starts. */
    void started();

    /**
     * Emitted when the terminal process exits.
     */
    void finished();

    /** Emitted when the session's title has changed. */
    void titleChanged(); // FIXME currently not used

    /*!
        This signal is emitted from the C++ side and the text displayed on the HTML client side.
    */
    void write(const QString &text);
public slots:
    void processInputCharacters(const QString &text);
    void reportEvent(const QString &name, const QString &data);
    void setWindowSize(int nrows, int ncols, int pixw, int pixh);
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
    void onReceiveBlock( const char * buffer, int len );
    KPtyDevice *pty() const;
private:
    Konsole::Pty     *_shellProcess;
    QString        _program;
    QStringList    _arguments;

    QStringList    _environment;
    bool           _autoClose;
    bool           _wantedClose;
    int            _sessionId;

    QString        _nameTitle;
    QString        _displayTitle;
    QString        _userTitle;

    QString        _initialWorkingDir;
    QString         _domtermVersion;
};

#endif
