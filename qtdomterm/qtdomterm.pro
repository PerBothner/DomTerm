TEMPLATE = app
TARGET = qtdomterm
QT += webenginewidgets network widgets webchannel
CONFIG += c++11

qtHaveModule(uitools):!embedded: QT += uitools
else: DEFINES += QT_NO_UITOOLS HAVE_POSIX_OPENPT

FORMS += \
    settings.ui

HEADERS += \
    backend.h Pty.h kptydevice.h  kpty.h  kpty_p.h  kptyprocess.h kprocess.h \
    browserapplication.h \
    browsermainwindow.h \
    fullscreennotification.h \
    modelmenu.h \
    settings.h \
    tabwidget.h \
    webview.h

SOURCES += \
    backend.cpp Pty.cpp kpty.cpp  kptydevice.cpp  kptyprocess.cpp kprocess.cpp \
    browserapplication.cpp \
    browsermainwindow.cpp \
    fullscreennotification.cpp \
    modelmenu.cpp \
    settings.cpp \
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

# install
target.path = ../bin
INSTALLS += target

DESTDIR = ../bin
