/****************************************************************************
**
** Copyright (C) 2016 The Qt Company Ltd.
** Contact: https://www.qt.io/licensing/
**
** This file is part of the demonstration applications of the Qt Toolkit.
**
** $QT_BEGIN_LICENSE:BSD$
** Commercial License Usage
** Licensees holding valid commercial Qt licenses may use this file in
** accordance with the commercial license agreement provided with the
** Software or, alternatively, in accordance with the terms contained in
** a written agreement between you and The Qt Company. For licensing terms
** and conditions see https://www.qt.io/terms-conditions. For further
** information use the contact form at https://www.qt.io/contact-us.
**
** BSD License Usage
** Alternatively, you may use this file under the terms of the BSD license
** as follows:
**
** "Redistribution and use in source and binary forms, with or without
** modification, are permitted provided that the following conditions are
** met:
**   * Redistributions of source code must retain the above copyright
**     notice, this list of conditions and the following disclaimer.
**   * Redistributions in binary form must reproduce the above copyright
**     notice, this list of conditions and the following disclaimer in
**     the documentation and/or other materials provided with the
**     distribution.
**   * Neither the name of The Qt Company Ltd nor the names of its
**     contributors may be used to endorse or promote products derived
**     from this software without specific prior written permission.
**
**
** THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
** "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
** LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
** A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
** OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
** SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
** LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
** DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
** THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
** (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
** OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."
**
** $QT_END_LICENSE$
**
****************************************************************************/

#include "browserapplication.h"

#include <qtwebenginewidgetsglobal.h>
#include <string.h>
#include <getopt.h>
#include <QProcessEnvironment>
#include <QDir>

const char* const short_options = "+vhw:e:c:S:";

const struct option long_options[] = {
    {"version", 0, NULL, 'v'},
    {"help",    0, NULL, 'h'},
    {"workdir", 1, NULL, 'w'},
    {"execute", 1, NULL, 'e'},
    {"connect", 1, NULL, 'c'},
    {"stylesheet", 1, NULL, 'S'},
    // The following option is handled internally in QtWebEngine.
    // We just need to pass it through without complaint to the QApplication.
    {"remote-debugging-port", 1, NULL, 0},
    {NULL,      0, NULL,  0}
};

void print_usage_and_exit(int code)
{
    printf("QtDomTerm %s\n", QTDOMTERM_VERSION);
    puts("Usage: qtdomterm [OPTION]...\n");
    //puts("  -d,  --drop               Start in \"dropdown mode\" (like Yakuake or Tilda)");
    puts("  -e,  --execute <command>  Execute command instead of shell");
    puts("  -c,  --connect HOST:PORT  Connect to websocket server");
    puts("  -h,  --help               Print this help");
    puts("  -v,  --version            Prints application version and exits");
    puts("  -w,  --workdir <dir>      Start session with specified work directory");
    puts("  -S,  --stylesheet <name>  Name of extra CSS stylesheet file");
    puts("\nHomepage: <https://domterm.org>");
    exit(code);
}

void print_version_and_exit(int code=0)
{
    printf("QtDomTerm %s, using Qt version %s.\n", QTDOMTERM_VERSION, qVersion());
    printf("Copyright %s Per Bothner.\n",  QTDOMTERM_YEAR);
    exit(code);
}

void parseArgs(int argc, char* argv[], ProcessOptions* processOptions)
{
    for (;;) {
        int next_option = getopt_long(argc, argv, short_options, long_options, NULL);
        switch(next_option) {
            case -1:
                goto post_args;
            case 'h':
                print_usage_and_exit(0);
                break;
            case 'w':
                processOptions->workdir = QString(optarg);
                break;
            case 'c':
                processOptions->wsconnect = QString(optarg);
                break;
            case 'S':
                // Shouldn't happen - main turns -S to --stylesheet,
                // and the QApplication contructor removes the latter.
                break;
            case 'e':
                optind--;
                goto post_args;
            case '?':
                print_usage_and_exit(1);
                break;
            case 'v':
                print_version_and_exit();
                break;
        }
    }
 post_args:
    QStringList arguments;
    QString program;
    if (optind < argc) {
        program = QString(argv[optind]);

    } else {
        const char *shell = getenv("SHELL");
        if (shell == nullptr)
            shell = "/bin/sh";
        program = shell;
    }
    processOptions->program = program;
    arguments += program;
    while (++optind < argc) {
        arguments += QString(argv[optind]);
    }
    processOptions->arguments = arguments;
    if (processOptions->workdir.isEmpty())
        processOptions->workdir = QDir::currentPath();

    const QString ws = processOptions->wsconnect;
    QString url = "qrc:/index.html";
    if (! ws.isEmpty()) {
        if (ws.startsWith("http:") || ws.startsWith("https:")
            || ws.startsWith("file:")) {
            url = ws;
            url += url.indexOf('#') < 0 ? "#" : "&";
            url += "qtwebengine";
            processOptions->frontendOnly = true;
        } else {
            url += "?ws=ws://";
            url += ws;
        }
    }
    processOptions->url = url;
}

int main(int argc, char **argv)
{
    ProcessOptions* processOptions = new ProcessOptions();
    QSharedDataPointer<ProcessOptions> processOptionsPtr(processOptions);
    processOptions->environment = QProcessEnvironment::systemEnvironment().toStringList();

    QCoreApplication::setAttribute(Qt::AA_EnableHighDpiScaling);
    Q_INIT_RESOURCE(data);

    // The QApplication constructor recognizes and removes a --stylesheet
    // option, before parseArgs can see it.  So we pre-extract it.
    char *styleSheet = NULL;
    parseArgs(argc, argv, processOptions);
    for (;;) {
        if (optind < argc && strcmp(argv[optind], "-stylesheet") == 0)
          argv[optind] = (char*) "--stylesheet";
        int next_option =
            getopt_long(argc, argv, short_options, long_options, NULL);
        if (next_option < 0)
            break;
        if (next_option == 'S') {
            styleSheet = optarg;
            // Let QApplication see a stylesheet specified with -S.
            if (strcmp(argv[optind-2], "-S") == 0)
                argv[optind-2] = (char*) "--stylesheet";
        }
    }
    optind = 1;

    BrowserApplication application(argc, argv, styleSheet, processOptionsPtr);
    if (!application.isTheOnlyBrowser())
        return 0;

    application.newMainWindow(processOptionsPtr);
    return application.exec();
}
