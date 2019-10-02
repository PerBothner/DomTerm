#source /home/bothner/DomTerm/tools/bash-preexec.sh
thisfile="$BASH_SOURCE"
case "$thisfile" in
  "") echo "installation error - can't find path to $0"; exit -1 ;;
  /*) ;;
  *) thisfile="$PWD/$thisfile"  ;;
esac
while test -L "$thisfile"; do thisfile=$(readlink -f "$thisfile"); done
source `dirname "$thisfile"`/bash-preexec.sh

#PS1='\[\e]133;P\a\]'$PS1'\[\e]133;B\a\e]122;> \a\]'
#PS1='\[\e]133]A;repaint;aid='"$BASHPID"'\a\e]133;P\a\]'$PS1'\[\e]133;B\a\e]122;> \a\]'
function __prompt_precmd() {
    local ret="$?"
    local err=`if test "$ret" != "0"; then echo ";err=$ret"; fi`
    _PROMPT_SAVE_PS1="$PS1"
    _PROMPT_SAVE_PS2="$PS2"
    PS1='\[\e]133;P;k=i\a\]'$PS1'\[\e]133;B\a\e]122;> \a\]'
    PS2='\[\e]133;P;k=c\a\]'$PS2'\[\e]133;B\a\]'
    if test "$_prompt_executing" = "1"
    then
       printf "\033]133;Z%s;aid=%s\007" "$err" "$BASHPID"
    fi
    printf "\033]133;A;cl=m;aid=%s\007" "$BASHPID"
    _prompt_executing=0
}
function __prompt_preexec() {
    PS1="$_PROMPT_SAVE_PS1"
    PS2="$_PROMPT_SAVE_PS2"
    printf "\033]133;C;\007"
    _prompt_executing=1
}
preexec_functions+=(__prompt_preexec)
precmd_functions+=(__prompt_precmd)
