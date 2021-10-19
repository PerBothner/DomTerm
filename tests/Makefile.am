check: test-24-bit-color

grapheme-break-test: GraphemeBreakTest.sh
	./GraphemeBreakTest.sh
GraphemeBreakTest.sh:
	<GraphemeBreakTest.txt sed -e '/^#/d' -e 's|[÷×] \([0-9A-F][0-9A-F]*\) |\\U\1|g' -e 's|^\(.*\)*[÷×].*[#]\(.*\)$$|echo -e "{\1}\t#\2"|' >$@
	chmod +x $@

DOMTERM = ../bin/domterm
TDOMTERM = $(DOMTERM) --socket-name=`pwd`/test-domterm
SEND_INPUT = $(TDOMTERM) send-input
TEST_SHELL = /bin/bash --noprofile --rcfile ./test-bash-rc.sh

test-24-bit-color:
	$(TDOMTERM) $(TEST_SHELL)
	@sleep 0.5
	@$(SEND_INPUT) -w 1 './24-bit-color.sh\r'
	@sleep 0.2
	$(TDOMTERM) capture -w 1 -e >t24.out
	cmp t24.exp t24.out
	$(SEND_INPUT) -w 1 'exit\r'
	@echo st-24-bit-color OK

clean:
	-rm -f *.out
