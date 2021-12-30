check: test-24-bit-color \
  test-UTF-8-width \
  test-grapheme-widths \
  test-grapheme-widths-byte-by-byte \
  test-vttest-1 \
  test-vttest-11-6-6-3 \
  test-wrap1

grapheme-break-test: GraphemeBreakTest.sh
	./GraphemeBreakTest.sh
GraphemeBreakTest.sh:
	<GraphemeBreakTest.txt sed -e '/^#/d' -e 's|[÷×] \([0-9A-F][0-9A-F]*\) |\\U\1|g' -e 's|^\(.*\)*[÷×].*[#]\(.*\)$$|echo -e "{\1}\t#\2"|' >$@
	chmod +x $@

DOMTERM = ../bin/domterm
TDOMTERM = $(DOMTERM) --socket-name=`pwd`/test-domterm
TNEWOPTIONS =
SEND_INPUT = $(TDOMTERM) send-input
TSEND_INPUT = $(TDOMTERM) -w 1 send-input
TDOKEYS = $(TDOMTERM) -w 1 do-keys
TAWAIT_CLOSE = $(TDOMTERM) -w 1 await --close
TCAPTURE = $(TDOMTERM) -w 1 capture
TEST_SHELL = /bin/bash --noprofile --rcfile ./test-bash-rc.sh
VTTEST = vttest

test-wrap1:
	$(SHELL) $(srcdir)/test-wrap1.sh

test-24-bit-color:
	$(TDOMTERM) $(TNEWOPTIONS) $(TEST_SHELL)
	$(TDOMTERM) -w 1 await --match-output '1[$$]' ''
	@$(TSEND_INPUT) './24-bit-color.sh\r'
	$(TDOMTERM) -w 1 await --match-output '2[$$]' ''
	$(TCAPTURE) -e >t24.out
	cmp t24.exp t24.out
	$(SEND_INPUT) -w 1 'exit\r'
	$(TAWAIT_CLOSE)
	@echo test-24-bit-color OK

test-UTF-8-width:
	$(TDOMTERM) $(TNEWOPTIONS) $(TEST_SHELL)
	$(TDOMTERM) -w 1 await --match-output '1[$$]' ''
	$(TSEND_INPUT) 'echo -e "\\e[8;24;80t"\r'
	$(TDOMTERM) -w 1 await --match-output '2[$$]' ''
	$(TSEND_INPUT) "cat ./UTF-8.txt\r"
	$(TDOMTERM) -w 1 await --match-output '3[$$]' ''
	$(TCAPTURE) -l >UTF-8-width.out
	cmp UTF-8-width.exp UTF-8-width.out
	$(SEND_INPUT) -w 1 'exit\r'
	$(TAWAIT_CLOSE)
	@echo test-UTF-8-width OK

test-grapheme-widths:
	$(TDOMTERM) $(TNEWOPTIONS) $(TEST_SHELL)
	$(TDOMTERM) -w 1 await --match-output '1[$$]' ''
	@$(TSEND_INPUT) 'sh ./grapheme-widths.sh --tests\r'
	$(TDOMTERM) -w 1 await --match-output '2[$$]' ''
	$(TCAPTURE) >grapheme-widths.out
	cmp grapheme-widths.exp grapheme-widths.out
	$(SEND_INPUT) -w 1 'exit\r'
	$(TAWAIT_CLOSE)
	@echo test-grapheme-widths OK

test-grapheme-widths-byte-by-byte:
	$(MAKE) test-grapheme-widths TNEWOPTIONS='output-byte-by-byte=-1'

test-vttest-1:
	$(TDOMTERM) $(TNEWOPTIONS) new $(VTTEST)
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 1 Enter
	$(TDOMTERM) -w 1 await --match-output '[+]        E with.*free position around it.*Push <RETURN>' '' 20
	$(TCAPTURE) -e -l -B >vtest-1-a.out
	cmp vtest-1-a.exp vtest-1-a.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output '[+]                                  E with  one.*Push <RETURN>' '' 20
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-b.out
	cmp vtest-1-b.exp vtest-1-b.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Test of autowrap' '' 30
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 1
#	Note vtest-1-c.out contains tabs assuming an 80-column terminal
	$(TDOMTERM) capture -w 1 -e -l -B -T >vtest-1-c.out
	cmp vtest-1-c.exp vtest-1-c.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'I {130}i' '' 30
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 1
	$(TDOMTERM) capture -w 1 -e -l -B -T >vtest-1-d.out
	cmp vtest-1-d.exp vtest-1-d.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Test of cursor-control characters' '' 30
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 1
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-e.out
	cmp vtest-1-e.exp vtest-1-e.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Test of leading zeros' '' 30
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 1
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-1-f.out
	cmp vtest-1-f.exp vtest-1-f.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 0 Enter
	$(TAWAIT_CLOSE)
	@echo vttest "[1: Test of cursor movements]" OK

test-vttest-11-6-6-3:
	$(TDOMTERM) $(TNEWOPTIONS) new $(VTTEST)
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 11 Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 6 Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 6 Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 3 Enter
	$(TDOMTERM) -w 1 await --match-output 'every second line' '' 30
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-a.out
	cmp vtest-11-6-6-3-a.exp vtest-11-6-6-3-a.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'every third line' '' 30
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-b.out
	cmp vtest-11-6-6-3-b.exp vtest-11-6-6-3-b.out
	$(TDOKEYS) 3 Enter
	$(TDOMTERM) -w 1 await --match-output 'Insert . Delete Line.*Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-c.out
	cmp vtest-11-6-6-3-c.exp vtest-11-6-6-3-c.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'this line, nothing more. Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-d.out
	cmp vtest-11-6-6-3-d.exp vtest-11-6-6-3-d.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'The top line .*Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-e.out
	cmp vtest-11-6-6-3-e.exp vtest-11-6-6-3-e.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Delete Character.*Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-f.out
	cmp vtest-11-6-6-3-f.exp vtest-11-6-6-3-f.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'by one.  Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-g.out
	cmp vtest-11-6-6-3-g.exp vtest-11-6-6-3-g.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output '\bXXXXXXXXXXXXXXXX\b' '' 30
	$(TDOMTERM) -w 1 await --match-output 'by one.  Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-h.out
	cmp vtest-11-6-6-3-h.exp vtest-11-6-6-3-h.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Insert Character' '' 30
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-i.out
	cmp vtest-11-6-6-3-i.exp vtest-11-6-6-3-i.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Screen accordion.*Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-j.out
	cmp vtest-11-6-6-3-j.exp vtest-11-6-6-3-j.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Top line: A.*Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-k.out
	cmp vtest-11-6-6-3-k.exp vtest-11-6-6-3-k.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Insert Mode.*Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-l.out
	cmp vtest-11-6-6-3-l.exp vtest-11-6-6-3-l.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Delete Character.*Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-m.out
	cmp vtest-11-6-6-3-m.exp vtest-11-6-6-3-m.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'by one.  Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-n.out
	cmp vtest-11-6-6-3-n.exp vtest-11-6-6-3-n.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'by one.  Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-o.out
	cmp vtest-11-6-6-3-o.exp vtest-11-6-6-3-o.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Push <RETURN>' '' 30
	$(TDOMTERM) capture -w 1 -e -l -B >vtest-11-6-6-3-p.out
	cmp vtest-11-6-6-3-p.exp vtest-11-6-6-3-p.out
	$(TDOKEYS) Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 0 Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 0 Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 0 Enter
	$(TDOMTERM) -w 1 await --match-output 'Enter choice number' ''
	$(TDOKEYS) 0 Enter
	$(TAWAIT_CLOSE)
	@echo vttest "[11.6.6.3: Insert/Delete Char/Line with BCE]" OK

clean:
	-rm -f *.out
