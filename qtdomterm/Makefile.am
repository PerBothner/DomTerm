all-am: qtdomterm$(EXEEXT) ../bin/qtdomterm$(EXEEXT)

SUFFIXES = .moc.cpp .h

# See comment about LN_H in ../lws-term/Makefile.am
LN_H = ln
../bin/qtdomterm$(EXEEXT): qtdomterm$(EXEEXT)
	$(MKDIR_P) ../bin
	@rm -f ../bin/qtdomterm$(EXEEXT)
if MACOS

	cd bin && ln -s ../qtdomterm/QtDomTerm.app/Contents/MacOS/QtDomTerm qtdomterm
else
	cd ../bin && $(LN_H) ../qtdomterm/qtdomterm$(EXEEXT) qtdomterm$(EXEEXT)
endif

.h.moc.cpp:
	$(MOC) \
	  `echo $(qtdomterm_CPPFLAGS) $(CPPFLAGS) | sed 's/-isystem/-I/g'` \
	  $(EXTRA_CPPFLAGS) $< -o $@

ui_savepagedialog.h: $(srcdir)/savepagedialog.ui
	$(UIC) $(srcdir)/savepagedialog.ui -o ui_savepagedialog.h
qtdomterm-savepagedialog.$(OBJEXT): ui_savepagedialog.h

EXTRA_DIST =  \
  LICENSE processoptions.h \
  backend.h browserapplication.h browsermainwindow.h \
  savepagedialog.h webview.h savepagedialog.ui

bin_PROGRAMS = qtdomterm
CLEANFILES = *.moc.cpp ui_savepagedialog.h

DEFS += -DQT_NO_UITOOLS -DHAVE_POSIX_OPENPT

qtdomterm_SOURCES  = $(BUILT_SOURCES) \
    backend.cpp \
    browserapplication.cpp \
    browsermainwindow.cpp \
    savepagedialog.cpp \
    webview.cpp \
    main.cpp

nodist_qtdomterm_SOURCES = \
  backend.moc.cpp \
  modelmenu.moc_cpp \
  browserapplication.moc.cpp \
  savepagedialog.moc.cpp \
  browsermainwindow.moc.cpp \
  webview.moc.cpp

#QT += webenginewidgets network widgets webchannel
qtdomterm_CXXFLAGS = $(QT_CXXFLAGS) $(AM_CXXFLAGS)
qtdomterm_CPPFLAGS = $(QT_CPPFLAGS) $(AM_CPPFLAGS)
qtdomterm_LDFLAGS  = $(QT_LDFLAGS) $(LDFLAGS)
qtdomterm_LDADD    = $(QT_LIBS) $(LDADD)
if USE_KDDockWidgets
qtdomterm_CPPFLAGS += -DUSE_KDDockWidgets=1 $(QT_DOCKING_CFLAGS)
qtdomterm_LDFLAGS += -L$(QT_DOCKING_LIBDIR)
LDADD =-lkddockwidgets
endif
if USE_QT_DOCKING
qtdomterm_CPPFLAGS += -DUSE_DOCK_MANAGER=1 $(QT_DOCKING_CFLAGS)
qtdomterm_LDFLAGS += -L$(QT_DOCKING_LIBDIR)
LDADD =-lqtadvanceddocking
endif
