# Regression test for an error shown by 'ps aux|grep domterm' (sometimes).
# Fixed by b8a167b "Fix line-breaking bug with continuation line starting with text".
. ./test-defs.sh
set -e
${TNEWDOMTERM}
${TDOMTERM} -w 1 await --match-output '1[$]' ''
${TSEND_INPUT} 'echo -e "\\e[8;24;65t"\r'
${TDOMTERM} -w 1 await --match-output '2[$]' ''
${TSEND_INPUT} 'echo -en "bothner    91161  0.0  0.0      0     0 ?        Z    16:04   0:00 [\\e[Kdomterm] <defunct>\\r\\nbothner    90999  0.0  0.0  10892  4264 ?        Ss   16:03   0:00 /home/bothner/tmp/DT/bin/\\e[01;31m\\e[Kdomterm\\e[m\\e[K --socket-name=bin-default --settings=/home/bothner/.config/\\e[01;31m\\e[Kdomterm\\e[m\\e[K/bin-settings.ini -Bchrome-app\\r\\n"\r'
${TDOMTERM} -w 1 await --match-output '3[$]' ''
${TCAPTURE} -l -e >test-wrap1a.out
base64 -d <<EOF | cmp - test-wrap1a.out
ChtbMzltG1s0OW0yJCBlY2hvIC1lbiAiYm90aG5lciA5MTE2MSAwLjAgMC4wIDAgMCA/IFogMTY6
MDQgMDowMCBbXGVbS2RvbXRlcgptXSA8ZGVmdW5jdD5cclxuYm90aG5lciA5MDk5OSAwLjAgMC4w
IDEwODkyIDQyNjQgPyBTcyAxNjowMyAwOjAwCi9ob21lL2JvdGhuZXIvdG1wL0RUL2Jpbi9cZVsw
MTszMW1cZVtLZG9tdGVybVxlW21cZVtLIC0tc29ja2V0LW5hCm1lPWJpbi1kZWZhdWx0IC0tc2V0
dGluZ3M9L2hvbWUvYm90aG5lci8uY29uZmlnL1xlWzAxOzMxbVxlW0tkb210CmVybVxlW21cZVtL
L2Jpbi1zZXR0aW5ncy5pbmkgLUJjaHJvbWUtYXBwXHJcbiIKYm90aG5lciA5MTE2MSAwLjAgMC4w
IDAgMCA/IFogMTY6MDQgMDowMCBbZG9tdGVybV0gPGRlZnVuY3Q+CmJvdGhuZXIgOTA5OTkgMC4w
IDAuMCAxMDg5MiA0MjY0ID8gU3MgMTY6MDMgMDowMCAvaG9tZS9ib3RobmVyL3RtCnAvRFQvYmlu
LxtbMW0bWzMxbWRvbXRlcm0bWzIybRtbMzltIC0tc29ja2V0LW5hbWU9YmluLWRlZmF1bHQgLS1z
ZXR0aW5ncz0vaG9tZS9ib3Robgplci8uY29uZmlnLxtbMW0bWzMxbWRvbXRlcm0bWzIybRtbMzlt
L2Jpbi1zZXR0aW5ncy5pbmkgLUJjaHJvbWUtYXBwCjMkCg==
EOF
${SEND_INPUT} -w 1 'exit\r'
${TAWAIT_CLOSE}
echo test-wrap1 OK
