#!/bin/bash
# From http://misc.flogisoft.com/bash/tip_colors_and_formatting
# See also http://web.archive.org/web/20131009193526/http://bitmote.com/index.php?post/2012/11/19/Using-ANSI-Color-Codes-to-Colorize-Your-Bash-Prompt-on-Linux
# See also http://stackoverflow.com/questions/15682537/ansi-color-specific-rgb-sequence-bash
     
# This program is free software. It comes without any warranty, to
# the extent permitted by applicable law. You can redistribute it
# and/or modify it under the terms of the Do What The Fuck You Want
# To Public License, Version 2, as published by Sam Hocevar. See
# http://sam.zoy.org/wtfpl/COPYING for more details.

for fgbg in 38 48 ; do #Foreground/Background
    for color in {0..255} ; do #Colors
    	#Display the color
    	#echo -en "\e[${fgbg};5;${color}m ${color}\t\e[0m"
    	echo -en "\e[${fgbg};5;${color}m"
        printf "%4d " ${color}
        echo -en "\e[0m"
    	#Display 16 colors per lines
    	if [ $((($color + 1) % 16)) == 0 ] ; then
    	    echo #New line
    	fi
    done
    echo #New line
done

exit 0
