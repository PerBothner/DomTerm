#ifndef PROCESS_OPTIONS_H
#define PROCESS_OPTIONS_H

class QString;
class QStringList;
class QDataStream;
class QSharedData;

class ProcessOptions : public QSharedData
{
 public:
     ProcessOptions();
     bool frontendOnly;
     QString url;
     QString wsconnect;
     QString geometry;

     bool should_connect() const { return ! wsconnect.isEmpty(); }

     friend QDataStream& operator>>(QDataStream&, ProcessOptions&);
     friend QDataStream& operator<<(QDataStream&, const ProcessOptions&);

};
QDataStream& operator<<(QDataStream& stream, const ProcessOptions& state);
QDataStream& operator>>(QDataStream& stream, ProcessOptions& state);

#endif // PROCESS_OPTIONS_H
