"""
Auslan Text-to-Sign Translator

Converts English text to Auslan sign sequences with proper grammar.

Pipeline:
    English Text → Tokenize → POS Tag → Gloss Rules → Sign Sequence → Avatar
"""

from .translator import AuslanTranslator
from .grammar import AuslanGrammar
from .gloss_rules import GlossRules
from .sign_sequencer import SignSequencer

__all__ = ['AuslanTranslator', 'AuslanGrammar', 'GlossRules', 'SignSequencer']
