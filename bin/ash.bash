#!/bin/bash

_ash_completions() {
    local cur prev opts
    COMPREPLY=()
    cur="${COMP_WORDS[COMP_CWORD]}"
    prev="${COMP_WORDS[COMP_CWORD-1]}"
    opts="list info search install uninstall status sync init help"
    
    # Primary commands
    if [ $COMP_CWORD -eq 1 ]; then
        COMPREPLY=( $(compgen -W "${opts}" -- ${cur}) )
        return 0
    fi

    # Sub command arguments
    case "${prev}" in
        install|uninstall|info)
            # Scan skills directory
            local skills_dir="$HOME/.ash/skills"
            if [ -d "$skills_dir" ]; then
                # Get files relative to skills dir
                # find . -name "*.md" returns ./category/file.md, sed removes ./
                local file_list=$(cd "$skills_dir" && find . -maxdepth 2 -name "*.md" 2>/dev/null | sed 's|^\./||')
                
                # Add simple names (basenames) for convenience if they are unique enough?
                # For now let's stick to paths found. 
                # Also user might type part of name.
                
                # Add --all for install/uninstall
                if [[ "${prev}" == "install" || "${prev}" == "uninstall" ]]; then
                    file_list="$file_list --all"
                fi
                
                COMPREPLY=( $(compgen -W "${file_list}" -- ${cur}) )
            fi
            return 0
            ;;
    esac
}
complete -F _ash_completions ash
