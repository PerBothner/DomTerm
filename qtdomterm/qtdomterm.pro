TEMPLATE = app
TARGET = ../bin/qtdomterm
QT += webenginewidgets network widgets webchannel
CONFIG += c++11

qtHaveModule(uitools):!embedded: QT += uitools
else: DEFINES += QT_NO_UITOOLS HAVE_POSIX_OPENPT

FORMS += \
    savepagedialog.ui

HEADERS += \
    backend.h Pty.h kptydevice.h  kpty.h  kpty_p.h  kptyprocess.h kprocess.h \
    browserapplication.h \
    browsermainwindow.h \
    fullscreennotification.h \
    modelmenu.h \
    savepagedialog.h \
    tabwidget.h \
    webview.h

SOURCES += \
    backend.cpp Pty.cpp kpty.cpp  kptydevice.cpp  kptyprocess.cpp kprocess.cpp \
    browserapplication.cpp \
    browsermainwindow.cpp \
    fullscreennotification.cpp \
    modelmenu.cpp \
    savepagedialog.cpp \
    tabwidget.cpp \
    webview.cpp \
    main.cpp

RESOURCES += data/data.qrc

build_all:!build_pass {
    CONFIG -= build_all
    CONFIG += release
}

win32 {
   RC_FILE = qtdomterm.rc
}

mac {
    ICON = qtdomterm.icns
    QMAKE_INFO_PLIST = Info_mac.plist
    TARGET = QtDomTerm
}

EXAMPLE_FILES = \
    Info_mac.plist qtdomterm.icns qtdomterm.ico qtdomterm.rc

#DESTDIR = ../bin

unix {
    isEmpty(PREFIX) {
        PREFIX = /usr/local
    }
    BINDIR = $$PREFIX/bin

    target.path = $$BINDIR

    DATADIR = $$PREFIX/share
    shortcut.path = $$DATADIR/applications
    shortcut.files = qtdomterm.desktop

    INSTALLS += target shortcut
}
