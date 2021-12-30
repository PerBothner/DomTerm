BIN_DOMTERM="${BIN_DOMTERM:-../bin/domterm}"
TDOMTERM="${BIN_DOMTERM} --socket-name=`pwd`/test-domterm"
#TNEWOPTIONS=
SEND_INPUT="${TDOMTERM} send-input"
TSEND_INPUT="${TDOMTERM} -w 1 send-input"
TDOKEYS="${TDOMTERM} -w 1 do-keys"
TAWAIT_CLOSE="${TDOMTERM} -w 1 await --close"
TCAPTURE="${TDOMTERM} -w 1 capture"
TEST_SHELL="/bin/bash --noprofile --rcfile ./test-bash-rc.sh"
VTTEST="vttest"
TNEWDOMTERM="${TDOMTERM} ${TNEWOPTIONS} ${TEST_SHELL}"
