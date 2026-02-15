"""
Auslan Text-to-Sign Translator

Main entry point for translating English text to sign sequences.
"""

import re
import sys
from typing import List, Dict, Optional, Tuple
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from .grammar import AuslanGrammar, GlossToken, SignType
from .sign_sequencer import SignSequencer


class AuslanTranslator:
    """
    Main translator class for English → Auslan signs.
    
    Usage:
        translator = AuslanTranslator(db_path="/path/to/signs.db")
        result = translator.translate("I want to go to the store")
        # result contains gloss sequence and sign videos
    """
    
    def __init__(self, db_path: Optional[str] = None):
        """
        Initialize the translator.
        
        Args:
            db_path: Path to SQLite database with signs. If None, uses default.
        """
        if db_path is None:
            # Default to signsymposium database
            db_path = str(Path(__file__).parent.parent / "auslan_game.db")
        
        self.grammar = AuslanGrammar()
        self.sequencer = SignSequencer(db_path)
        self._init_nltk()
    
    def _init_nltk(self):
        """Initialize NLTK for POS tagging."""
        try:
            import nltk
            # Download required data if not present
            try:
                nltk.data.find('tokenizers/punkt')
            except LookupError:
                nltk.download('punkt', quiet=True)
            try:
                nltk.data.find('taggers/averaged_perceptron_tagger')
            except LookupError:
                nltk.download('averaged_perceptron_tagger', quiet=True)
            
            self.nltk_available = True
        except ImportError:
            print("Warning: NLTK not available. Using simple tokenization.")
            self.nltk_available = False
    
    def translate(self, text: str) -> Dict:
        """
        Translate English text to Auslan sign sequence.
        
        Args:
            text: English sentence or phrase
            
        Returns:
            Dictionary containing:
                - input: Original text
                - gloss_sequence: List of gloss strings
                - tokens: List of GlossToken objects
                - sign_sequence: List of sign data (videos, poses)
                - non_manual_features: Facial expression data
                - timing: Timing information for animation
        """
        # Step 1: Tokenize and POS tag
        words, pos_tags = self._tokenize_and_tag(text)
        
        # Step 2: Convert to gloss with grammar rules
        gloss_tokens = self.grammar.english_to_gloss(words, pos_tags)
        
        if not gloss_tokens:
            return {
                'input': text,
                'gloss_sequence': [],
                'tokens': [],
                'sign_sequence': [],
                'error': 'No recognizable signs found'
            }
        
        # Step 3: Look up signs in database
        sign_sequence = self.sequencer.lookup_signs(gloss_tokens)
        
        # Step 4: Add non-manual features
        non_manual = self.grammar.add_non_manual_features(gloss_tokens)
        
        # Step 5: Calculate timing
        timing = self.sequencer.calculate_timing(sign_sequence)
        
        return {
            'input': text,
            'gloss_sequence': [t.gloss for t in gloss_tokens],
            'tokens': [
                {
                    'gloss': t.gloss,
                    'type': t.sign_type.value,
                    'spatial_index': t.spatial_index,
                    'modifiers': t.modifiers
                }
                for t in gloss_tokens
            ],
            'sign_sequence': sign_sequence,
            'non_manual_features': non_manual,
            'timing': timing,
            'english_word_order': words,
            'grammar_notes': self._generate_grammar_notes(gloss_tokens, words)
        }
    
    def _tokenize_and_tag(self, text: str) -> Tuple[List[str], List[Tuple[str, str]]]:
        """
        Tokenize English text and apply POS tags.
        
        Returns:
            Tuple of (words, pos_tags) where pos_tags is list of (word, tag)
        """
        # Clean text
        text = text.strip()
        
        if self.nltk_available:
            import nltk
            tokens = nltk.word_tokenize(text)
            pos_tags = nltk.pos_tag(tokens)
            words = [w.lower() for w, _ in pos_tags]
            return words, pos_tags
        else:
            # Simple fallback tokenization
            words = re.findall(r'\b\w+\b', text.lower())
            # Simple POS heuristic
            pos_tags = self._simple_pos_tag(words)
            return words, pos_tags
    
    def _simple_pos_tag(self, words: List[str]) -> List[Tuple[str, str]]:
        """Simple rule-based POS tagging as fallback."""
        tagged = []
        
        for i, word in enumerate(words):
            tag = 'NN'  # Default to noun
            
            # Check for known words first
            if word in self.grammar.GLOSS_MAP:
                # Infer from gloss type
                gloss = self.grammar.GLOSS_MAP[word]
                if any(gloss.startswith(v) for v in ['GO', 'COME', 'WANT', 'LIKE', 'HAVE', 'EAT', 'DRINK', 'SEE', 'KNOW']):
                    tag = 'VB'
                elif gloss in ['WHAT', 'WHERE', 'WHEN', 'WHO', 'WHY', 'HOW']:
                    tag = 'WP'
                elif word in ['i', 'you', 'he', 'she', 'it', 'we', 'they']:
                    tag = 'PRP'
            
            # Suffix rules
            elif word.endswith('ing'):
                tag = 'VBG'
            elif word.endswith('ed'):
                tag = 'VBD'
            elif word.endswith('ly'):
                tag = 'RB'
            elif word.endswith('s') and i > 0:  # Could be plural noun or verb
                tag = 'NNS'
            
            tagged.append((word, tag))
        
        return tagged
    
    def _generate_grammar_notes(self, tokens: List[GlossToken], original_words: List[str]) -> List[str]:
        """Generate notes explaining the translation choices."""
        notes = []
        
        # Check for word order changes
        original_order = ' '.join(original_words[:len(tokens)]).upper()
        gloss_order = ' '.join([t.gloss for t in tokens])
        
        if original_order != gloss_order:
            notes.append(f"Word order changed from English SVO to Auslan topic-comment structure")
        
        # Note dropped words
        dropped = [w for w in original_words if w.lower() in self.grammar.DROPPED_WORDS]
        if dropped:
            notes.append(f"Articles/auxiliaries dropped: {', '.join(dropped)}")
        
        # Note time markers
        time_tokens = [t for t in tokens if t.sign_type == SignType.TIME]
        if time_tokens:
            notes.append(f"Time markers moved to sentence start: {', '.join([t.gloss for t in time_tokens])}")
        
        # Note question movement
        question_tokens = [t for t in tokens if t.sign_type == SignType.QUESTION]
        if question_tokens:
            notes.append(f"Question word moved to end: {', '.join([t.gloss for t in question_tokens])}")
        
        # Note spatial indexing
        spatial_tokens = [t for t in tokens if t.spatial_index is not None]
        if len(spatial_tokens) > 1:
            notes.append(f"Spatial indexing used for {len(spatial_tokens)} referents")
        
        return notes
    
    def translate_batch(self, texts: List[str]) -> List[Dict]:
        """Translate multiple texts."""
        return [self.translate(text) for text in texts]
    
    def get_available_signs(self) -> List[str]:
        """Get list of all available signs in the database."""
        return self.sequencer.get_available_signs()
    
    def add_custom_gloss(self, english: str, gloss: str, sign_type: SignType):
        """Add a custom word-to-gloss mapping."""
        self.grammar.GLOSS_MAP[english.lower()] = gloss
        # Note: This doesn't persist across restarts


# Convenience function for quick translation
def translate(text: str, db_path: Optional[str] = None) -> Dict:
    """Quick translate function."""
    translator = AuslanTranslator(db_path)
    return translator.translate(text)


if __name__ == '__main__':
    # Test the translator
    test_sentences = [
        "I want to go to the store",
        "Where is the bathroom",
        "I am happy today",
        "Do you like coffee",
        "My brother went to school yesterday"
    ]
    
    translator = AuslanTranslator()
    
    for sentence in test_sentences:
        print(f"\n{'='*60}")
        print(f"Input: {sentence}")
        print(f"{'='*60}")
        
        result = translator.translate(sentence)
        
        print(f"Gloss: {' '.join(result['gloss_sequence'])}")
        print(f"Signs found: {len([s for s in result['sign_sequence'] if s.get('found')])}/{len(result['sign_sequence'])}")
        
        if result.get('grammar_notes'):
            print(f"\nGrammar notes:")
            for note in result['grammar_notes']:
                print(f"  • {note}")
