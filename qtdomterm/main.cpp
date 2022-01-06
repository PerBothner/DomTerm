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
#include <unistd.h>
#include <qtwebenginewidgetsglobal.h>
#include <string.h>
#include <getopt.h>
#include <QProcessEnvironment>
#include <QDir>

const char* const short_options = "+:vhw:e:c:S:";

#define QT_OPTION 1000
#define GEOMETRY_OPTION 1001
#define HEADLESS_OPTION 1002
#define NO_TITLEBAR_OPTION 1003

const struct option long_options[] = {
    {"version", 0, NULL, 'v'},
    {"help",    0, NULL, 'h'},
    {"connect", 1, NULL, 'c'},
    // The following option is handled internally in QtWebEngine.
    // We just need to pass it through without complaint to the QApplication.
    {"remote-debugging-port", 1, NULL, QT_OPTION},
    {"geometry", 1, NULL, GEOMETRY_OPTION},
    {"headless", 0, NULL, HEADLESS_OPTION},
    {"no-titlebar", 0, NULL, NO_TITLEBAR_OPTION},
    {NULL,      0, NULL,  0}
};

void print_usage_and_exit(int code)
{
    printf("QtDomTerm %s\n", QTDOMTERM_VERSION);
    puts("Usage: qtdomterm [OPTION]...\n");
    //puts("  -d,  --drop               Start in \"dropdown mode\" (like Yakuake or Tilda)");
    puts("  -c,  --connect HOST:PORT  Connect to websocket server");
    puts("  -h,  --help               Print this help");
    puts("  -v,  --version            Prints application version and exits");
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
            default:
            case -1:
                goto post_args;
            case 'h':
                print_usage_and_exit(0);
                break;
            case 'c':
                processOptions->wsconnect = QString(optarg);
                break;
            case 'v':
                print_version_and_exit();
                break;
            case NO_TITLEBAR_OPTION:
                processOptions->titlebar = false;
                break;
            case HEADLESS_OPTION:
                processOptions->headless = true;
                break;
            case GEOMETRY_OPTION:
                // syntax of geometry option has been checked by domterm
                processOptions->geometry = QString(optarg);
                break;
            case QT_OPTION:
                break;
        }
    }
 post_args:
    const QString ws = processOptions->wsconnect;
    if (! ws.isEmpty()) {
        QString url = ws;
        url += url.indexOf('#') < 0 ? "#" : "&";
        url += "qtwebengine";
        processOptions->frontendOnly = true;
        processOptions->url = url;
    } else {
        char **nargv = new char*[argc+2];
        char *name = strdup(argv[0]);
        int len = strlen(name);
        if (strcmp(name+len-9, "qtdomterm") == 0)
          strcpy(name+len-9, "domterm");
        else
          name = (char*)"domterm";
        nargv[0] = name;
        nargv[1] = (char*)"--qtdomterm";
        for (int i = 1; i < argc; i++)
          nargv[i+1] = argv[i];
        nargv[argc+1] = NULL;
        execvp(name, nargv);
    }
}

int main(int argc, char **argv)
{
    ProcessOptions* processOptions = new ProcessOptions();
    QSharedDataPointer<ProcessOptions> processOptionsPtr(processOptions);

    parseArgs(argc, argv, processOptions);
    optind = 1;

    if (! processOptions->headless)
        QCoreApplication::setAttribute(Qt::AA_EnableHighDpiScaling);

    BrowserApplication application(argc, argv, processOptionsPtr);
    //if (!application.isTheOnlyBrowser())
    // return 0;

    application.newMainWindow(processOptionsPtr->url, processOptionsPtr);
    return application.exec();
}
