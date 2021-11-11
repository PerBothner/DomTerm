# Some tests for Grapheme Clusters and Wide characters
# Tabs (followed by '#') are used to verify correct width.
echo -e '12345678123456781234567812345678\r\t|\t|\t|'
echo -e "{\U1F1F3\U1F1F4\U1F1E8\U0062}	|  ÷ [0.2] REGIONAL INDICATOR SYMBOL LETTER N (RI) × [12.0] REGIONAL INDICATOR SYMBOL LETTER O (RI) ÷ [999.0] REGIONAL INDICATOR SYMBOL LETTER C (RI) ÷ [999.0] LATIN SMALL LETTER B (Other) ÷ [0.3]"
echo -e "1234567812345678\r{\U1F1F3\U1F1F4\U1F1E8\U0062}\t|"
echo -e "1234567812345678\r{\U1F1F3\U1F1F4}\t|"
echo -e "{\U1F476\U1F3FF\U1F476}\t|  ÷ [0.2] BABY (ExtPict) × [9.0] EMOJI MODIFIER FITZPATRICK TYPE-6 (Extend) ÷ [999.0] BABY (ExtPict) ÷ [0.3]"
echo -e "1234567812345678\r{\U1F476\U1F476\U1F3FFX}\t|"
echo -e '{\U0061\U0301}\t|  letter a × acute accent'
echo -e 'oooooooooooooooo\r{\U0061\U0301}\t|'
echo -e '{\U1100\U1161\U11A8}\t| Hangul syllables (correct on Firefox)'
echo -e '1234567812345678\r{\U1100\U1161\U11A8}\t| Hangul syllables (correct on Firefox)'
echo -e '{\U1F469\U200D\U1F469\U200D\U1F467\U200D\U1F466}\t| WOMAN+ZWJ+WOMAN+ZWJ+GIRL+ZWJ+BOY'
echo -e '{\U1F469\U200D\U1F469\U200D\U1F466}\t| WOMAN+ZWJ+WOMAN+ZWJ+BOY'
echo -e '{\U1F926\U1F3FC\U200D\U2642\UFE0F}\t|'
echo -e '1234567812345678\r{\U1F926\U1F3FC\U200D\U2642\UFE0F}\t|'
echo -e '{\U1F469}\t| WOMAN'
echo -e '12345678123456781234\r{x哀公}\t|'
echo -e '12345678123456781234\r{哀公xy問}\t|'
