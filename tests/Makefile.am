check: test-24-bit-color

grapheme-break-test: GraphemeBreakTest.sh
	./GraphemeBreakTest.sh
GraphemeBreakTest.sh:
	<GraphemeBreakTest.txt sed -e '/^#/d' -e 's|[÷×] \([0-9A-F][0-9A-F]*\) |\\U\1|g' -e 's|^\(.*\)*[÷×].*[#]\(.*\)$$|echo -e "{\1}\t#\2"|' >$@
	chmod +x $@

DOMTERM = ../bin/domterm
TDOMTERM = $(DOMTERM) --socket-name=`pwd`/test-domterm
TNEWOPTIONS =
SEND_INPUT = $(TDOMTERM) send-input
DO_KEYS = $(TDOMTERM) do-keys
TEST_SHELL = /bin/bash --noprofile --rcfile ./test-bash-rc.sh
VTTEST = vttest

test-24-bit-color:
	$(TDOMTERM) $(TEST_SHELL)
	@sleep 0.5
	@$(SEND_INPUT) -w 1 './24-bit-color.sh\r'
	@sleep 0.2
	$(TDOMTERM) capture -w 1 -e >t24.out
	cmp t24.exp t24.out
	$(SEND_INPUT) -w 1 'exit\r'
	@echo st-24-bit-color OK

test-vttest-1:
	$(TDOMTERM) $(TNEWOPTIONS) new $(VTTEST)
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(DO_KEYS) -w 1 1 Enter
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 20
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-a.out
	cmp vtest-1-a.exp vtest-1-a.out
	$(DO_KEYS) -w 1 Enter
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 20
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-b.out
	cmp vtest-1-b.exp vtest-1-b.out
	$(DO_KEYS) -w 1 Enter
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 1
#	Note vtest-1-c.out contains tabs assuming an 80-column terminal
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-c.out
	cmp vtest-1-c.exp vtest-1-c.out
	$(DO_KEYS) -w 1 Enter
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 1
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-d.out
	cmp vtest-1-d.exp vtest-1-d.out
	$(DO_KEYS) -w 1 Enter
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 1
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-e.out
	cmp vtest-1-e.exp vtest-1-e.out
	$(DO_KEYS) -w 1 Enter
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 1
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-f.out
	cmp vtest-1-f.exp vtest-1-f.out
	$(DO_KEYS) -w 1 Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(DO_KEYS) -w 1 0 Enter
	@echo vttest "[1: Test of cursor movements]" ok

clean:
	-rm -f *.out
